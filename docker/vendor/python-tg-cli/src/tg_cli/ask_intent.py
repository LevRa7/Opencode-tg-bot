"""Lightweight intent classification for tg ask."""

from __future__ import annotations

from typing import Any

from .session_policy import top_keywords

_SUMMARY_MARKERS = (
    "overview",
    "summary",
    "summarize",
    "overview",
    "big picture",
    "о чем",
    "обзор",
    "суммарно",
    "summary",
)
_PEOPLE_MARKERS = (
    "who",
    "alice",
    "bob",
    "кто",
    "человек",
    "люди",
)
_EVIDENCE_MARKERS = (
    "evidence",
    "prove",
    "proof",
    "quote",
    "цитат",
    "доказ",
    "подтвер",
)
_TIMELINE_MARKERS = (
    "when",
    "timeline",
    "before",
    "after",
    "когда",
    "сначала",
    "потом",
)


def classify_question(question: str) -> dict[str, Any]:
    lowered = question.lower()
    intent = "general"
    if any(marker in lowered for marker in _EVIDENCE_MARKERS):
        intent = "evidence_lookup"
    elif any(marker in lowered for marker in _SUMMARY_MARKERS):
        intent = "summary"
    elif any(marker in lowered for marker in _PEOPLE_MARKERS):
        intent = "people"
    elif any(marker in lowered for marker in _TIMELINE_MARKERS):
        intent = "timeline"

    return {
        "intent": intent,
        "keywords": top_keywords([question]),
        "needs_evidence": intent in {"evidence_lookup", "timeline"},
        "prefers_summary": intent == "summary",
        "prefers_people_memory": intent == "people",
    }
