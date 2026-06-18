---
name: yandex-rasp-api
description: Yandex Rasp API — поиск расписания поездов/электричек, получение маршрутов и генерация ссылок на покупку билетов через Яндекс Путешествия и мини-апп
author: lev
version: "2.0.0"
tags:
  - yandex
  - rasp
  - trains
  - suburban
  - schedule
  - tickets
  - api
  - ras
---

# Yandex Rasp API Skill v2

API Яндекс.Расписаний — получение расписания поездов, электричек, автобусов и самолётов, генерация MiniApp-ссылок на `@TicketTouch_bot`.

## Activation

Этот скилл активируется, когда пользователь запрашивает расписание поездов/электричек, информацию о маршрутах, или ссылки для покупки билетов через Яндекс.

## Prerequisites

```bash
export YA_RASP_API_KEY="b3327276-0ea2-49b4-b61b-f2f5242f0f99"
export YA_RASP_API_URL="https://api.rasp.yandex-net.ru/v3.0"
export YA_RASP_CACHE_DIR="${HOME}/.cache/yandex-rasp"
mkdir -p "$YA_RASP_CACHE_DIR"/{stations,schedules,regions}
```

## CRITICAL RULE: MiniApp-ссылки в каждый заголовок

**Каждый рейс в расписании ОБЯЗАТЕЛЬНО выводится как кликабельный Markdown-заголовок с MiniApp-ссылкой.**

Формат:
```
[N. 🚆 НОМЕР «ТИП» ОТПР–ПРИБ (N мин) ЦЕНА₽ — МАРШРУТ](https://t.me/TicketTouch_bot/app?startapp=<base64json>)
```

Генерация ссылки (Python):
```python
import json, base64
TT_MAP = {"suburban": 0, "last": 1, "lastm": 2, "mcd3": 3, "train": 4}
def ma_link(from_name, to_name, price="65", tt=0):
    payload = {"action":"openTicket","from":from_name,"to":to_name,"price":str(price),"tt":tt}
    enc = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False, separators=(",",":")).encode()).decode().rstrip("=")
    return f"https://t.me/TicketTouch_bot/app?startapp={enc}"
```

**Ни один рейс не выводится без MiniApp-ссылки. Всегда встраивай ссылку прямо в заголовок строки расписания.**

---

## API Endpoints

### 1. Поиск расписания между станциями

```
GET /v3.0/search/
from, to, apikey — обязательные
date, transport_types, system, limit, offset, transfers, add_days_mask — опционально
```

### 2. Информация о нитке (все остановки)

```
GET /v3.0/thread/
uid, apikey — обязательные
```

Используется для получения кода станции из списка остановок, если станция является промежуточной.

### 3. Список всех станций (тяжёлый)

```
GET /v3.0/stations_list/
apikey — обязательный
```

### 4. Ближайшие станции по координатам

```
GET /v3.0/nearest_stations/
lat, lng, distance — обязательные
```

### 5. Расписание по станции

```
GET /v3.0/schedule/
station, apikey — обязательные
event=departure|arrival
```

---

## ПОЛНЫЙ АЛГОРИТМ РАБОТЫ (Station Resolution Pipeline)

### Этап 1: Проверка кэша станций

```python
import json, os, glob
CACHE_DIR = os.environ.get("YA_RASP_CACHE_DIR", os.path.expanduser("~/.cache/yandex-rasp"))

def search_stations_cache(query: str):
    """Поиск станции по подстроке во всех кэшированных данных."""
    query = query.lower()
    results = {}
    # 1. Кэш станций
    for f in glob.glob(f"{CACHE_DIR}/stations/stations_*.json"):
        with open(f) as fh:
            for code, title in json.load(fh).items():
                if query in title.lower():
                    results[code] = title
    # 2. Кэш расписаний (встречающиеся from/to)
    for f in glob.glob(f"{CACHE_DIR}/schedules/*.json"):
        with open(f) as fh:
            data = json.load(fh)
        for seg in data.get("segments", []):
            for key in ("from", "to"):
                st = seg.get(key, {})
                c, t = st.get("code"), st.get("title", "")
                if c and t and query in t.lower():
                    results[c] = t
    return results
```

### Этап 2: API-поиск по stations_list (с кэшированием)

```bash
# Получение полного списка станций с кэшированием на 7 дней
CACHE_FILE="$YA_RASP_CACHE_DIR/stations/full_list.json"
if [ -f "$CACHE_FILE" ] && [ $(find "$CACHE_FILE" -mtime +7) ]; then
    echo "CACHE HIT"
else
    echo "CACHE MISS: загрузка stations_list"
    curl -s "$YA_RASP_API_URL/stations_list/?apikey=$YA_RASP_API_KEY&lang=ru_RU&format=json" > "$CACHE_FILE"
fi

# Поиск по станциям с группировкой по регионам и населённым пунктам
python3 << 'PYEOF'
import json, os, sys
query = sys.argv[1].lower() if len(sys.argv) > 1 else ""

with open(os.environ["YA_RASP_CACHE_DIR"] + "/stations/full_list.json") as f:
    data = json.load(f)

for country in data.get("countries", []):
    for region in country.get("regions", []):
        rname = region.get("title", "")
        for settlement in region.get("settlements", []):
            sname = settlement.get("title", "")
            for station in settlement.get("stations", []):
                title = station.get("title", "")
                code = station.get("code", "")
                stype = station.get("station_type", "")
                transport = station.get("transport_type", "")
                if (query in title.lower() or query in sname.lower()) and transport in ("train", "suburban"):
                    print(f"{title:40s} | {sname:25s} | {rname:30s} | code={code} | type={stype}")
PYEOF
```

**Алгоритм поиска станции по текстовому запросу (по шагам):**

1. **Поиск по известным кодам** — если пользователь ввёл код вида `s960XXXX`, используем его напрямую.
2. **Поиск в кэше станций** (`search_stations_cache`) — быстрый поиск по всем ранее встреченным станциям.
3. **Поиск по полному списку** (`stations_list` с кэшем) — загружаем полный справочник и ищем по подстроке.
4. **Если станция не найдена — запрос региона и населённого пункта**:
   - Спрашиваем пользователя: *"В каком регионе/области находится станция?"*
   - После получения региона, выгружаем список населённых пунктов этого региона со станциями
   - Спрашиваем: *"В каком населённом пункте?"*
   - После получения населённого пункта, показываем все станции в нём
5. **Поиск через нитку (thread)** — если станция заведомо есть на маршруте, получаем код через остановки существующего рейса.
6. **nearest_stations (координаты)** — если известен населённый пункт, но станция не найдена по имени, используем координаты населённого пункта и `nearest_stations` чтобы найти ближайшие ж/д станции.

### Этап 3: Получение регионов и населённых пунктов

```python
def list_regions():
    """Выводит все регионы, где есть ж/д станции."""
    with open(f"{CACHE_DIR}/stations/full_list.json") as f:
        data = json.load(f)
    for country in data.get("countries", []):
        for region in country.get("regions", []):
            rname = region.get("title", "")
            # Считаем станции в регионе
            stations_count = sum(
                len([s for s in st.get("stations", []) if s.get("transport_type") in ("train", "suburban")])
                for st in region.get("settlements", [])
            )
            if stations_count > 0:
                print(f"{rname} — {stations_count} станций")

def list_settlements_in_region(region_query: str):
    """Выводит населённые пункты в регионе, где есть ж/д станции."""
    with open(f"{CACHE_DIR}/stations/full_list.json") as f:
        data = json.load(f)
    for country in data.get("countries", []):
        for region in country.get("regions", []):
            if region_query.lower() in region.get("title", "").lower():
                for settlement in region.get("settlements", []):
                    sname = settlement.get("title", "")
                    stations = [
                        s for s in settlement.get("stations", [])
                        if s.get("transport_type") in ("train", "suburban")
                    ]
                    if stations:
                        types = set(s.get("station_type", "") for s in stations)
                        print(f"{sname:30s} | {len(stations)} станций | типы: {', '.join(sorted(types))}")

def list_stations_in_settlement(region_query: str, settlement_query: str):
    """Выводит все ж/д станции в указанном населённом пункте и регионе."""
    with open(f"{CACHE_DIR}/stations/full_list.json") as f:
        data = json.load(f)
    for country in data.get("countries", []):
        for region in country.get("regions", []):
            if region_query.lower() in region.get("title", "").lower():
                for settlement in region.get("settlements", []):
                    if settlement_query.lower() in settlement.get("title", "").lower():
                        for station in settlement.get("stations", []):
                            if station.get("transport_type") in ("train", "suburban"):
                                print(f"{station['title']:35s} | code={station['code']} | type={station.get('station_type', '')}")
```

### Этап 4: Fallback — nearest_stations

Если станция не найдена по имени, но известен населённый пункт:

```python
# Координаты крупных городов (можно расширять в кэше)
CITY_COORDS = {
    "санкт-петербург": (59.939095, 30.315868),
    "москва": (55.7558, 37.6173),
    "выборг": (60.710, 28.750),
    "песочный": (60.123, 30.158),
    "зеленогорск": (60.200, 29.700),
}

def find_nearby_stations(city_name: str, distance: int = 10):
    """Ищет ближайшие ж/д станции к населённому пункту."""
    city_key = city_name.lower().strip()
    if city_key not in CITY_COORDS and os.path.exists(f"{CACHE_DIR}/stations/coords_cache.json"):
        with open(f"{CACHE_DIR}/stations/coords_cache.json") as f:
            CITY_COORDS.update(json.load(f))
    
    if city_key not in CITY_COORDS:
        print(f"⚠ Не знаю координаты для '{city_name}'. Уточни регион и населённый пункт.")
        return []
    
    lat, lng = CITY_COORDS[city_key]
    resp = requests.get(f"{API_URL}/nearest_stations/", params={
        "apikey": API_KEY, "lat": lat, "lng": lng,
        "distance": distance, "format": "json", "lang": "ru_RU"
    })
    data = resp.json()
    results = []
    for st in data.get("stations", []):
        if st.get("transport_type") in ("train", "suburban"):
            results.append((st["title"], st["code"], st.get("station_type", ""), st.get("distance", 0)))
    return sorted(results, key=lambda x: x[3])
```

---

## КЭШИРОВАНИЕ (Persistent Cache Layer)

### Структура кэша

```
~/.cache/yandex-rasp/
├── stations/
│   ├── full_list.json          # Полный stations_list (TTL 7 дней)
│   ├── stations_YYYYMMDD.json  # Инкрементальные обновления
│   ├── coords_cache.json       # Координаты населённых пунктов
│   └── region_index.json       # Индекс: регион → населённые пункты → станции
├── schedules/
│   └── <md5_hash>.json         # Ответы search/ (TTL 1 час)
└── regions/
    └── region_map.json         # Кэш иерархии регионов
```

### Утилиты кэширования

```bash
# ---- Инициализация/обновление кэша ----
cache_update_stations() {
    local force="${1:-false}"
    local cache_file="$YA_RASP_CACHE_DIR/stations/full_list.json"
    
    if [ "$force" = "true" ] || [ ! -f "$cache_file" ] || [ $(find "$cache_file" -mtime +7) ]; then
        echo "🔄 Обновление кэша станций..."
        curl -s "$YA_RASP_API_URL/stations_list/?apikey=$YA_RASP_API_KEY&lang=ru_RU&format=json" > "$cache_file"
        
        # Строим индекс регионов
        python3 << 'PYEOF'
import json, os
CACHE_DIR = os.environ["YA_RASP_CACHE_DIR"]
with open(f"{CACHE_DIR}/stations/full_list.json") as f:
    data = json.load(f)

# region_index: region_name -> {settlements: [(name, [stations])]}
index = {}
for country in data.get("countries", []):
    for region in country.get("regions", []):
        rname = region.get("title", "")
        settlements = []
        for settlement in region.get("settlements", []):
            stations = [
                {"title": s["title"], "code": s["code"], "type": s.get("station_type", ""), "transport": s.get("transport_type", "")}
                for s in settlement.get("stations", [])
                if s.get("transport_type") in ("train", "suburban")
            ]
            if stations:
                settlements.append({
                    "title": settlement.get("title", ""),
                    "stations": stations
                })
        if settlements:
            index[rname] = {"settlements": settlements}

with open(f"{CACHE_DIR}/stations/region_index.json", "w") as f:
    json.dump(index, f, ensure_ascii=False, indent=2)
print(f"✅ Индекс регионов: {len(index)} регионов")
PYEOF
        echo "✅ Кэш станций обновлён"
    else
        echo "✅ Кэш станций актуален"
    fi
}

# ---- Кэширование расписания ----
cache_schedule() {
    local from="$1" to="$2" date="$3" transport="${4:-suburban}"
    local key=$(echo "${from}_${to}_${date}_${transport}" | md5sum | cut -d' ' -f1)
    local cache_file="$YA_RASP_CACHE_DIR/schedules/${key}.json"
    
    if [ -f "$cache_file" ] && [ $(find "$cache_file" -mtime +1) ]; then
        echo "CACHE HIT: $cache_file" >&2
        cat "$cache_file"
        return
    fi
    
    echo "CACHE MISS: запрос к API" >&2
    resp=$(curl -s "$YA_RASP_API_URL/search/?apikey=$YA_RASP_API_KEY&from=$from&to=$to&date=$date&transport_types=$transport&format=json&lang=ru_RU")
    echo "$resp" > "$cache_file"
    echo "$resp"
}

# ---- Поиск по кэшу станций (быстрый) ----
cache_find_station() {
    local query="$1"
    python3 << PYEOF
import json, os, glob

query = "$query".lower()
CACHE_DIR = os.environ["YA_RASP_CACHE_DIR"]
results = {}

# Из region_index
idx_file = f"{CACHE_DIR}/stations/region_index.json"
if os.path.exists(idx_file):
    with open(idx_file) as f:
        index = json.load(f)
    for rname, rdata in index.items():
        for s in rdata.get("settlements", []):
            for st in s.get("stations", []):
                if query in st["title"].lower():
                    results[st["code"]] = st["title"]

# Из schedules cache
for f in glob.glob(f"{CACHE_DIR}/schedules/*.json"):
    try:
        with open(f) as fh:
            data = json.load(fh)
    except:
        continue
    for seg in data.get("segments", []):
        for key in ("from", "to"):
            st = seg.get(key, {})
            c, t = st.get("code"), st.get("title", "")
            if c and t and query in t.lower():
                results[c] = t

for code, title in results.items():
    print(f"{title:45s} | code={code}")
PYEOF
}

# ---- Утилита: список регионов из кэша ----
cache_list_regions() {
    python3 << 'PYEOF'
import json, os
CACHE_DIR = os.environ["YA_RASP_CACHE_DIR"]
idx_file = f"{CACHE_DIR}/stations/region_index.json"
if os.path.exists(idx_file):
    with open(idx_file) as f:
        index = json.load(f)
    for rname, rdata in sorted(index.items()):
        total = sum(len(s["stations"]) for s in rdata["settlements"])
        settlements = len(rdata["settlements"])
        print(f"{rname:45s} | {settlements:3d} населённых пунктов | {total:4d} станций")
else:
    print("❌ Индекс регионов не найден. Выполни cache_update_stations сначала")
PYEOF
}

# ---- Утилита: населённые пункты в регионе ----
cache_list_settlements() {
    local region_query="$1"
    python3 << PYEOF
import json, os
CACHE_DIR = os.environ["YA_RASP_CACHE_DIR"]
query = "$region_query".lower()
idx_file = f"{CACHE_DIR}/stations/region_index.json"
if os.path.exists(idx_file):
    with open(idx_file) as f:
        index = json.load(f)
    for rname, rdata in index.items():
        if query in rname.lower():
            print(f"📍 {rname}")
            for s in rdata["settlements"]:
                types = set(st["type"] for st in s["stations"])
                print(f"   {s['title']:30s} | {len(s['stations']):3d} станций | {', '.join(sorted(types))}")
            print()
else:
    print("❌ Индекс не найден")
PYEOF
}

# ---- Утилита: станции в населённом пункте ----
cache_list_stations() {
    local region_query="$1"
    local settlement_query="$2"
    python3 << PYEOF
import json, os
CACHE_DIR = os.environ["YA_RASP_CACHE_DIR"]
rq = "$region_query".lower()
sq = "$settlement_query".lower()
idx_file = f"{CACHE_DIR}/stations/region_index.json"
if os.path.exists(idx_file):
    with open(idx_file) as f:
        index = json.load(f)
    for rname, rdata in index.items():
        if rq in rname.lower():
            for s in rdata["settlements"]:
                if sq in s["title"].lower():
                    print(f"🏘 {s['title']} ({rname})")
                    for st in s["stations"]:
                        marker = "🚆" if st["transport"] in ("train", "suburban") else "🚌"
                        print(f"   {marker} {st['title']:35s} | code={st['code']} | {st['type']}")
                    print()
PYEOF
}
```

### Периодическая инвалидация

```bash
# stations_list — TTL 7 дней
find "$YA_RASP_CACHE_DIR/stations" -name "*.json" -mtime +7 -delete

# schedules — TTL 1 час (расписание меняется)
find "$YA_RASP_CACHE_DIR/schedules" -name "*.json" -mtime +1 -delete

# Ручная очистка
rm -rf "$YA_RASP_CACHE_DIR"
```

---

## АЛГОРИТМ ОБРАБОТКИ ЗАПРОСА ПОЛЬЗОВАТЕЛЯ

```
1. ПАРСИНГ ЗАПРОСА
   Извлекаем: from_station, to_station, date, transport_type
   Если дата не указана → сегодня
   Если "завтра" → date + 1 день
   Тип транспорта: "электричка" → suburban, "поезд" → train

2. РЕЗОЛВ СТАНЦИЙ (Station Resolution)
   for each station (from, to):
     a. Если код вида s960XXXX — использовать напрямую
     b. Поиск в кэше станций (cache_find_station)
     c. Если 1 результат → используем
     d. Если 0 результатов:
        - Спрашиваем регион (список из cache_list_regions)
        - Получаем населённые пункты региона (cache_list_settlements)
        - Спрашиваем населённый пункт
        - Показываем станции (cache_list_stations)
        - Если станции нет в списке → nearest_stations по координатам города
     e. Если >1 результата — показываем все и просим уточнить

3. ЗАПРОС РАСПИСАНИЯ
   resp = cache_schedule(from_code, to_code, date, transport)
   
4. ФОРМАТИРОВАНИЕ (с MiniApp-ссылками в каждый заголовок)
   Каждый сегмент:
     [N. 🚆 НОМЕР «ТИП» dep–arr (dur мин) price₽ — МАРШРУТ](<ma_link>)
   
   Если нет tickets_info — цена 65₽ для suburban
   🚄 для Ласточки (transport_subtype.code = "last")
   🚆 для обычной электрички

5. ВЫВОД
   📅 Название дня (сегодня/завтра/дата)
   📍 Откуда → Куда
   ---
    [1. 🚆 6107 «Пригородный поезд» 06:40–07:08 (28 мин) 65₽ — СПб-Фин. → Песочная](ссылка)
    [2. ...](...)
```

---

## Workflow: полный пример обработки

```python
#!/usr/bin/env python3
import json, base64, os, hashlib, time, requests
from datetime import datetime, timedelta

API_KEY = os.environ["YA_RASP_API_KEY"]
API_URL = os.environ.get("YA_RASP_API_URL", "https://api.rasp.yandex-net.ru/v3.0")
CACHE_DIR = os.environ.get("YA_RASP_CACHE_DIR", os.path.expanduser("~/.cache/yandex-rasp"))

TT_MAP = {"suburban": 0, "last": 1, "lastm": 2, "mcd3": 3, "train": 4}

def ma_link(from_name, to_name, price="65", tt=0):
    payload = {"action":"openTicket","from":from_name,"to":to_name,"price":str(price),"tt":tt}
    enc = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False, separators=(",",":")).encode()).decode().rstrip("=")
    return f"https://t.me/TicketTouch_bot/app?startapp={enc}"

def resolve_station(query):
    """Полный резолв станции по текстовому запросу."""
    query = query.strip()
    
    # Шаг 1: известный код
    if query.startswith("s") and len(query) == 8 and query[1:].isdigit():
        return query, None
    
    # Шаг 2: кэш станций
    from glob import glob
    results = {}
    for f in glob(f"{CACHE_DIR}/schedules/*.json"):
        try:
            with open(f) as fh:
                data = json.load(fh)
        except: continue
        for seg in data.get("segments", []):
            for key in ("from", "to"):
                st = seg.get(key, {})
                c, t = st.get("code"), st.get("title", "")
                if c and t and query.lower() in t.lower():
                    results[c] = t
    
    if len(results) == 1:
        code, title = next(iter(results.items()))
        return code, title
    elif len(results) > 1:
        print("Найдено несколько станций:")
        for c, t in results.items():
            print(f"  {t} — code={c}")
        return None, results  # need disambiguation
    
    # Шаг 3: полный список
    cache_file = f"{CACHE_DIR}/stations/full_list.json"
    if os.path.exists(cache_file):
        with open(cache_file) as f:
            data = json.load(f)
        for country in data.get("countries", []):
            for region in country.get("regions", []):
                for settlement in region.get("settlements", []):
                    for station in settlement.get("stations", []):
                        title = station.get("title", "")
                        code = station.get("code", "")
                        if query.lower() in title.lower() and station.get("transport_type") in ("train", "suburban"):
                            results[code] = title
    
    if len(results) == 1:
        code, title = next(iter(results.items()))
        return code, title
    elif len(results) > 1:
        print("Найдено несколько станций (уточни):")
        for c, t in results.items():
            print(f"  {t} — code={c}")
        return None, results
    
    return None, {}  # not found

def get_schedule(from_code, to_code, date, transport="suburban"):
    """Получение расписания с кэшированием."""
    key = hashlib.md5(f"{from_code}_{to_code}_{date}_{transport}".encode()).hexdigest()
    cache_file = f"{CACHE_DIR}/schedules/{key}.json"
    
    if os.path.exists(cache_file):
        age = time.time() - os.path.getmtime(cache_file)
        if age < 3600:  # 1 hour TTL
            with open(cache_file) as f:
                return json.load(f)
    
    resp = requests.get(f"{API_URL}/search/", params={
        "apikey": API_KEY, "from": from_code, "to": to_code,
        "date": date, "transport_types": transport, "format": "json", "lang": "ru_RU"
    })
    data = resp.json()
    os.makedirs(os.path.dirname(cache_file), exist_ok=True)
    with open(cache_file, "w") as f:
        json.dump(data, f, ensure_ascii=False)
    return data

def format_schedule(data, from_name=None, to_name=None):
    """Форматирование расписания с MiniApp-ссылками в каждый заголовок."""
    search = data.get("search", {})
    from_title = from_name or search.get("from", {}).get("title", "?")
    to_title = to_name or search.get("to", {}).get("title", "?")
    date_str = search.get("date", "")
    
    lines = [f"📅 **{date_str}** — {from_title} → {to_title}", ""]
    
    segments = data.get("segments", [])
    for i, seg in enumerate(segments, 1):
        dep = seg["departure"][11:16]
        arr = seg["arrival"][11:16]
        dur = int(seg["duration"] // 60)
        num = seg["thread"]["number"]
        subtype_code = seg["thread"].get("transport_subtype", {}).get("code", "suburban")
        subtype_title = seg["thread"].get("transport_subtype", {}).get("title", "")
        route = seg["thread"].get("short_title", "")
        tt = TT_MAP.get(subtype_code, 0)
        
        places = seg.get("tickets_info")
        if places:
            places = places.get("places", [])
            price = str(places[0]["price"]["whole"]) if places else "65"
        else:
            price = "65"
        
        link = ma_link(from_title, to_title, price, tt)
        marker = "🚄" if tt >= 1 else "🚆"
        lines.append(f"{i}. [{marker} {num} «{subtype_title}» {dep}–{arr} ({dur} мин) {price}₽ — {route}]({link})")
    
    return "\n".join(lines)

# ==== Пример использования ====
if __name__ == "__main__":
    # user: "расписание электричек из спб в песочную на завтра"
    from_code, from_name = resolve_station("финляндский")
    to_code, to_name = resolve_station("песочная")
    
    if not from_code:
        print("Уточни станцию отправления:", from_name if from_name else "не найдена")
        exit()
    if not to_code:
        print("Уточни станцию назначения. В каком регионе?")
        # ... диалог уточнения ...
        exit()
    
    date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    data = get_schedule(from_code, to_code, date)
    print(format_schedule(data, from_name, to_name))
```

---

## Workflow: Bash-версия (быстрый запуск)

```bash
#!/bin/bash

# ---- Инициализация ----
export YA_RASP_API_KEY="b3327276-0ea2-49b4-b61b-f2f5242f0f99"
export YA_RASP_API_URL="https://api.rasp.yandex-net.ru/v3.0"
export YA_RASP_CACHE_DIR="${HOME}/.cache/yandex-rasp"
mkdir -p "$YA_RASP_CACHE_DIR"/{stations,schedules}

source "$(dirname "$0")/yandex-rasp-lib.sh" 2>/dev/null || true

# ---- MiniApp-генератор (bash) ----
ma_encode() {
    python3 -c "
import json, base64, sys
f,t,p,tt = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
payload = {'action':'openTicket','from':f,'to':t,'price':p,'tt':tt}
enc = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False, separators=(',',':')).encode()).decode().rstrip('=')
print(enc)
" "$1" "$2" "$3" "${4:-0}"
}

ma_link() {
    local enc=$(ma_encode "$1" "$2" "$3" "${4:-0}")
    echo "https://t.me/TicketTouch_bot/app?startapp=${enc}"
}

# ---- Универсальный поиск станции ----
find_station() {
    local query="$1"
    
    # 1. Проверка кэша
    local cached=$(cache_find_station "$query" 2>/dev/null)
    if [ -n "$cached" ]; then
        local count=$(echo "$cached" | wc -l)
        if [ "$count" -eq 1 ]; then
            echo "$cached"
            return 0
        else
            echo "$cached" >&2
            return 2  # multiple results
        fi
    fi
    
    # 2. Полный список (если кэш есть)
    local cache_file="$YA_RASP_CACHE_DIR/stations/full_list.json"
    if [ -f "$cache_file" ]; then
        python3 << PYEOF
import json, sys
query = "$query".lower()
with open("$cache_file") as f:
    data = json.load(f)
results = []
for country in data.get("countries", []):
    for region in country.get("regions", []):
        for settlement in region.get("settlements", []):
            for station in settlement.get("stations", []):
                title = station.get("title", "")
                code = station.get("code", "")
                if query in title.lower() and code:
                    results.append(f"{title} | code={code}")
if len(results) == 1:
    print(results[0])
elif len(results) > 1:
    print("\n".join(results[:30]), file=sys.stderr)
    sys.exit(2)
else:
    sys.exit(1)
PYEOF
        local rc=$?
        return $rc
    fi
    
    return 1
}

# ---- Запрос расписания + генерация ссылок ----
get_rasp() {
    local from_code="$1" to_code="$2" date="$3" transport="${4:-suburban}"
    
    local resp=$(cache_schedule "$from_code" "$to_code" "$date" "$transport")
    
    python3 << PYEOF
import json, base64, sys

data = json.loads('''$resp''')
search = data.get("search", {})
segments = data.get("segments", [])

from_title = search.get("from", {}).get("title", "?")
to_title = search.get("to", {}).get("title", "?")

print(f"📅 {search.get('date', '?')}")
print(f"📍 {from_title} → {to_title}")
print()

TT_MAP = {"suburban": 0, "last": 1, "lastm": 2, "mcd3": 3, "train": 4}

for i, seg in enumerate(segments, 1):
    dep = seg["departure"][11:16]
    arr = seg["arrival"][11:16]
    dur = int(seg["duration"] // 60)
    num = seg["thread"]["number"]
    subtype_code = seg["thread"].get("transport_subtype", {}).get("code", "suburban")
    subtype_title = seg["thread"].get("transport_subtype", {}).get("title", "")
    route = seg["thread"].get("short_title", "")
    tt = TT_MAP.get(subtype_code, 0)
    
    places = seg.get("tickets_info")
    if places:
        places = places.get("places", [])
        price = str(places[0]["price"]["whole"]) if places else "65"
    else:
        price = "65"
    
    payload = {"action":"openTicket","from":from_title,"to":to_title,"price":price,"tt":tt}
    enc = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False, separators=(",",":")).encode()).decode().rstrip("=")
    link = f"https://t.me/TicketTouch_bot/app?startapp={enc}"
    
    marker = "🚄" if tt >= 1 else "🚆"
    print(f"{i}. [{marker} {num} «{subtype_title}» {dep}–{arr} ({dur} мин) {price}₽ — {route}]({link})")
PYEOF
}
```

---

## Известные коды станций (пополняемый кэш)

| Станция | Код | Тип |
|---|---|---|
| Санкт-Петербург (Финляндский вокзал) | `s9602497` | train_station |
| Санкт-Петербург (Витебский вокзал) | `s9603088` | train_station |
| Санкт-Петербург (Московский вокзал) | `s9601109` | train_station |
| Мельничный Ручей | `s9601712` | station |
| Песочная | `s9603537` | platform |
| Зеленогорск | `s9602697` | station |
| Выборг | `s9603175` | train_station |
| Павловск | `s9602600` | station |
| Сосново | `s9602488` | station |
| Белоостров | `s9603525` | station |
| Ланская | `s9603444` | station |
| Удельная | `s9603463` | station |
| Левашово | `s9603624` | station |
| Парголово | `s9603832` | station |
| Москва (Ленинградский вокзал) | `s2006004` | train_station |
| Москва (Казанский вокзал) | `s9601109` | train_station |

---

## Обработка ошибок

| HTTP | Описание | Решение |
|---|---|---|
| 200 | Успех | — |
| 400 | Неверные параметры | Проверь `from`, `to`, `date` |
| 401 | Неверный API-ключ | Проверь `YA_RASP_API_KEY` |
| 403 | Доступ запрещён | Ключ не активирован / превышен лимит |
| 404 | Данные не найдены | Проверь коды станций и дату |
| 429 | Too many requests | Добавь задержку |

---

## Примечания

1. **Новый домен API**: `api.rasp.yandex-net.ru` (вместо `api.rasp.yandex.net`)
2. **Ключ API** передаётся в параметре `apikey`
3. **CRITICAL**: Каждый рейс — кликабельный Markdown-заголовок с MiniApp-ссылкой на `@TicketTouch_bot`
4. **TTL кэша**: stations_list — 7 дней, schedules — 1 час
5. **Лимиты**: бесплатный тариф — 10 запросов/сек, 10000 запросов/сутки
6. **Продажа билетов** на электрички открывается за 10 суток до отправления
