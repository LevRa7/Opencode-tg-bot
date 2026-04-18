"""Open loop detection and lightweight resolution."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

_MARKERS = ("напишу", "скину", "потом", "позже", "завтра")
_RESOLUTION_MARKERS = ("отправил", "отправила", "скинул", "скинула", "готово", "сделал", "сделала")


def detect_open_loops(messages: list[dict[str, Any]], *, subject_id: str) -> list[dict[str, Any]]:
    loops = []
    for message in messages:
        text = (message.get("content") or "").lower().strip()
        if any(marker in text for marker in _MARKERS):
            loops.append(
                {
                    "loop_id": f"loop:{subject_id}:{uuid4().hex[:8]}",
                    "chat_id": message["chat_id"],
                    "subject_id": subject_id,
                    "description": message.get("content") or "",
                    "status": "open",
                    "created_at": message["timestamp"],
                    "source_msg_id": message["msg_id"],
                }
            )
    return loops


def resolve_open_loops(loops: list[dict[str, Any]], messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    resolved = []
    for loop in loops:
        updated = dict(loop)
        for message in messages:
            text = (message.get("content") or "").lower().strip()
            if any(marker in text for marker in _RESOLUTION_MARKERS):
                updated["status"] = "resolved"
                updated["resolved_at"] = message["timestamp"]
                updated["resolution_msg_id"] = message["msg_id"]
                break
        resolved.append(updated)
    return resolved
