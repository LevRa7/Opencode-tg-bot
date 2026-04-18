"""Heuristics and text helpers for derived dialog sessions."""

from __future__ import annotations

import re
from collections import Counter

SEGMENT_GAP_HOURS = 18
SEGMENT_SOFT_GAP_HOURS = 6
MIN_MESSAGES_PER_SEGMENT = 4
COMPACTION_MIN_SEGMENTS = 4
COMPACTION_PRESERVED_TAIL = 2
COMPACTION_EXTRA_SALIENCE_SEGMENTS = 1
TOP_KEYWORDS_LIMIT = 5

_STOPWORDS = {
    "the",
    "and",
    "that",
    "this",
    "with",
    "from",
    "have",
    "your",
    "just",
    "into",
    "about",
    "http",
    "https",
    "www",
    "что",
    "это",
    "как",
    "для",
    "или",
    "так",
    "надо",
    "ещё",
    "еще",
    "если",
    "там",
    "тут",
    "уже",
    "потом",
    "после",
    "сегодня",
    "завтра",
    "просто",
}

_OPEN_LOOP_MARKERS = (
    "?",
    "потом",
    "позже",
    "скину",
    "напомни",
    "созвони",
    "проверю",
    "уточню",
    "later",
    "follow up",
    "remind",
    "check back",
)

_LINK_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_TOKEN_RE = re.compile(r"[A-Za-zА-Яа-яЁё0-9_\-]{4,}")


def contains_link(text: str) -> bool:
    return bool(_LINK_RE.search(text))


def tokenize(text: str) -> list[str]:
    tokens = []
    for token in _TOKEN_RE.findall(text.lower()):
        if token in _STOPWORDS:
            continue
        if token.isdigit():
            continue
        tokens.append(token)
    return tokens


def top_keywords(texts: list[str], limit: int = TOP_KEYWORDS_LIMIT) -> list[str]:
    counter: Counter[str] = Counter()
    for text in texts:
        counter.update(tokenize(text))
    return [token for token, _ in counter.most_common(limit)]


def looks_like_open_loop(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _OPEN_LOOP_MARKERS)


def preview_texts(texts: list[str], *, limit: int = 2, width: int = 80) -> str:
    previews: list[str] = []
    for text in texts:
        normalized = text.replace("\n", " ").strip()
        if not normalized:
            continue
        previews.append(normalized[:width])
        if len(previews) >= limit:
            break
    return " | ".join(previews) if previews else "no text preview"
