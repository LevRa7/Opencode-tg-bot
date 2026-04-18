"""Safe extraction of explicit subject observations from message text."""

from __future__ import annotations

import re
from typing import Any

_WORK_PATTERNS = [
    re.compile(r"\bя\s+(?:сейчас\s+)?работаю\s+в\s+(.+)", re.IGNORECASE),
    re.compile(r"\bработаю\s+в\s+(.+)", re.IGNORECASE),
]
_STUDY_PATTERNS = [
    re.compile(r"\bя\s+учусь\s+в\s+(.+)", re.IGNORECASE),
    re.compile(r"\bучусь\s+в\s+(.+)", re.IGNORECASE),
]
_CITY_PATTERNS = [
    re.compile(r"\bя\s+в\s+городе\s+(.+)", re.IGNORECASE),
    re.compile(r"\bживу\s+в\s+(.+)", re.IGNORECASE),
]
_HOBBY_PATTERNS = [
    re.compile(r"\bлюблю\s+(.+)", re.IGNORECASE),
    re.compile(r"\bзанимаюсь\s+(.+)", re.IGNORECASE),
]
_PROJECT_PATTERNS = [
    re.compile(r"\bделаю\s+проект\s+(.+)", re.IGNORECASE),
    re.compile(r"\bмой\s+проект\s+(.+)", re.IGNORECASE),
]


def _extract_value(patterns: list[re.Pattern[str]], text: str) -> str | None:
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            value = match.group(1).strip(" .,!?:;\n\t")
            if value:
                return value
    return None


def extract_subject_observations(message: dict[str, Any]) -> list[dict[str, Any]]:
    text = (message.get("content") or "").strip()
    if not text:
        return []
    observations: list[dict[str, Any]] = []
    observed_at = message.get("timestamp")
    msg_id = message.get("msg_id")

    mapping = [
        ("work", _WORK_PATTERNS),
        ("study", _STUDY_PATTERNS),
        ("city", _CITY_PATTERNS),
        ("hobby", _HOBBY_PATTERNS),
        ("project", _PROJECT_PATTERNS),
    ]
    for field, patterns in mapping:
        value = _extract_value(patterns, text)
        if value:
            observations.append(
                {
                    "field": field,
                    "value": value,
                    "explicitly_stated": True,
                    "confidence": 1.0,
                    "observed_at": observed_at,
                    "source_msg_id": msg_id,
                }
            )
    return observations
