"""Lightweight ontology-oriented extractors for goals, constraints, places, projects, and bond signals."""

from __future__ import annotations

import re
from typing import Any

_GOAL_PATTERNS = [
    re.compile(r"\bхочу\s+(.+)", re.IGNORECASE),
    re.compile(r"\bпланирую\s+(.+)", re.IGNORECASE),
]
_CONSTRAINT_PATTERNS = [
    re.compile(r"\bсложно\b", re.IGNORECASE),
    re.compile(r"\bдолго\b", re.IGNORECASE),
    re.compile(r"\bне могу\b", re.IGNORECASE),
]
_LOCATION_PATTERNS = [
    ("current_location", re.compile(r"\bживу\s+в\s+(.+)", re.IGNORECASE)),
    ("travel_intent", re.compile(r"\b(?:я\s+сейчас\s+)?в\s+(.+?)\s+хочу\s+поехать", re.IGNORECASE)),
    ("travel_intent", re.compile(r"\bхочу\s+в\s+(.+?)\s+поехать", re.IGNORECASE)),
]
_PROJECT_PATTERNS = [
    re.compile(r"\bдоделать\s+(.+)", re.IGNORECASE),
    re.compile(r"\bпроект\s+(.+)", re.IGNORECASE),
]


def extract_goals(message: dict[str, Any]) -> list[dict[str, Any]]:
    text = (message.get("content") or "").strip()
    goals = []
    for pattern in _GOAL_PATTERNS:
        match = pattern.search(text)
        if match:
            goals.append({"label": match.group(1).strip(), "source_msg_id": message.get("msg_id")})
    return goals


def extract_constraints(message: dict[str, Any]) -> list[dict[str, Any]]:
    text = (message.get("content") or "").strip()
    return [
        {"label": text, "source_msg_id": message.get("msg_id")}
        for pattern in _CONSTRAINT_PATTERNS
        if pattern.search(text)
    ]


def extract_location_signals(message: dict[str, Any]) -> list[dict[str, Any]]:
    text = (message.get("content") or "").strip()
    results = []
    for signal_type, pattern in _LOCATION_PATTERNS:
        match = pattern.search(text)
        if match:
            results.append(
                {
                    "signal_type": signal_type,
                    "label": match.group(1).strip(),
                    "source_msg_id": message.get("msg_id"),
                }
            )
    return results


def extract_occupation_or_project_signals(message: dict[str, Any]) -> list[dict[str, Any]]:
    text = (message.get("content") or "").strip()
    results = []
    for pattern in _PROJECT_PATTERNS:
        match = pattern.search(text)
        if match:
            results.append({"label": match.group(1).strip(), "source_msg_id": message.get("msg_id")})
    return results


def extract_bond_components(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    text = " ".join((message.get("content") or "").lower() for message in messages)
    components = []
    if "круто" in text or "без души" in text:
        components.append({"component": "feedback"})
    if "что с тобой" in text or "стрем" in text:
        components.append({"component": "care"})
    if "/login" in text or "бот" in text:
        components.append({"component": "support"})
    return components
