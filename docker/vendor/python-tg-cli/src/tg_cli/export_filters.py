"""Helpers for export filtering by media kind, size, and absolute time range."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def parse_size_limit(raw: str | None) -> int | None:
    if not raw:
        return None
    normalized = raw.strip().lower()
    if normalized.endswith("mb"):
        return int(float(normalized[:-2]) * 1024 * 1024)
    if normalized.endswith("kb"):
        return int(float(normalized[:-2]) * 1024)
    return int(normalized)


def _in_range(ts: str, since: str | None, until: str | None) -> bool:
    current = datetime.fromisoformat(ts)
    if since and current < datetime.fromisoformat(since):
        return False
    if until and current >= datetime.fromisoformat(until):
        return False
    return True


def filter_export_messages(
    messages: list[dict[str, Any]],
    *,
    media_filters: set[str] | None,
    max_file_size: int | None,
    since: str | None,
    until: str | None,
) -> list[dict[str, Any]]:
    filtered = []
    for message in messages:
        if not _in_range(message["timestamp"], since, until):
            continue
        if not media_filters:
            if message.get("has_media"):
                continue
            filtered.append(message)
            continue
        media_kind = message.get("media_kind") or message.get("message_kind")
        if media_kind not in media_filters:
            continue
        if max_file_size is not None and (message.get("media_size_bytes") or 0) > max_file_size:
            continue
        filtered.append(message)
    return filtered
