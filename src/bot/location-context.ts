/**
 * Location context enrichment: weather, timezone, and traffic info
 * for coordinates received from Telegram location messages.
 */

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  description: string;
}

export interface LocationContext {
  timezone: string;
  utcOffset: number;
  localTime: string;
  weather?: WeatherData;
  trafficNote?: string;
}

const WMO_WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function weatherCodeToDescription(code: number): string {
  return WMO_WEATHER_CODES[code] ?? `Unknown (${code})`;
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTimezone(
  latitude: number,
  longitude: number,
): Promise<{ timezone: string; utcOffset: number; localTime: string } | null> {
  try {
    const resp = await fetchWithTimeout(
      `https://timeapi.io/api/timezone/coordinate?latitude=${latitude}&longitude=${longitude}`,
    );
    if (!resp.ok) return null;
    const data = await resp.json() as {
      timeZone?: string;
      currentUtcOffset?: { seconds?: number };
      currentLocalTime?: string;
    };
    return {
      timezone: data.timeZone ?? "UTC",
      utcOffset: data.currentUtcOffset?.seconds ?? 0,
      localTime: data.currentLocalTime ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function fetchWeather(
  latitude: number,
  longitude: number,
): Promise<WeatherData | null> {
  try {
    const resp = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`,
    );
    if (!resp.ok) return null;
    const data = await resp.json() as {
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        weather_code?: number;
      };
    };
    if (!data.current) return null;

    const code = data.current.weather_code ?? 0;
    return {
      temperature: data.current.temperature_2m ?? 0,
      feelsLike: data.current.apparent_temperature ?? 0,
      humidity: data.current.relative_humidity_2m ?? 0,
      windSpeed: data.current.wind_speed_10m ?? 0,
      weatherCode: code,
      description: weatherCodeToDescription(code),
    };
  } catch {
    return null;
  }
}

export async function fetchLocationContext(
  latitude: number,
  longitude: number,
): Promise<LocationContext> {
  const [tz, weather] = await Promise.all([
    fetchTimezone(latitude, longitude),
    fetchWeather(latitude, longitude),
  ]);

  return {
    timezone: tz?.timezone ?? "UTC",
    utcOffset: tz?.utcOffset ?? 0,
    localTime: tz?.localTime ?? new Date().toISOString(),
    weather: weather ?? undefined,
  };
}

export function formatLocationContextText(ctx: LocationContext): string {
  const lines: string[] = [];
  lines.push(`[Timezone: ${ctx.timezone}, UTC${ctx.utcOffset >= 0 ? "+" : ""}${ctx.utcOffset / 3600}h, local time: ${ctx.localTime}]`);

  if (ctx.weather) {
    const w = ctx.weather;
    lines.push(
      `[Weather: ${w.description}, ${w.temperature}°C (feels like ${w.feelsLike}°C), humidity ${w.humidity}%, wind ${w.windSpeed} km/h]`,
    );
  }

  lines.push(
    "[System] When forming schedules, timetables, or time-based responses, use the timezone and local time above. The user's local time may differ from the region time — clarify if needed.",
  );
  lines.push(
    "[System] When the user asks about transport stops, stations, or points of interest — prioritize those located in the direction of movement (heading), not behind or in the opposite direction. If no heading data is available, ask the user which direction they are traveling.",
  );

  if (ctx.trafficNote) {
    lines.push(`[Traffic: ${ctx.trafficNote}]`);
  }

  return lines.join("\n");
}

/**
 * Maps timezone to a UTC offset string that can be used
 * for formatting the [datetime] tag in user metadata.
 */
export function timezoneToOffsetString(utcOffsetSeconds: number): string {
  const totalMinutes = utcOffsetSeconds / 60;
  const hours = Math.floor(Math.abs(totalMinutes) / 60);
  const minutes = Math.abs(totalMinutes) % 60;
  const sign = utcOffsetSeconds >= 0 ? "+" : "-";
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}
