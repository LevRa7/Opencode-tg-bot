"""Extract lightweight social context from dialog messages."""

from __future__ import annotations

import re
from typing import Any

_NAME_RE = re.compile(r"\b([А-ЯЁ][а-яё]{2,})\b")
_STOP = {"Лев", "Снежана", "Потому", "После", "Сначала", "Вам"}
_NORMALIZE = {
    "Ингой": "Инга",
    "Сереги": "Серега",
    "Яна": "Ян",
}


def extract_social_context(messages: list[dict[str, Any]], *, chat_id: int) -> dict[str, Any]:
    people = {}
    common_candidates = []
    close_signals = []
    for message in messages:
        text = (message.get("content") or "")
        names = [_NORMALIZE.get(name, name) for name in _NAME_RE.findall(text) if name not in _STOP]
        for name in names:
            people.setdefault(name, {"name": name, "first_seen_msg_id": message["msg_id"]})
        if len(names) >= 2:
            common_candidates.append(
                {
                    "msg_id": message["msg_id"],
                    "names": names,
                    "reason": "multiple named third parties in shared context",
                }
            )
        if "у нас" in text.lower() or "мы с" in text.lower():
            for name in names:
                close_signals.append(
                    {
                        "msg_id": message["msg_id"],
                        "name": name,
                        "reason": "collective/shared-circle phrasing",
                    }
                )
    return {
        "people": list(people.values()),
        "common_acquaintance_candidates": common_candidates,
        "close_contact_signals": close_signals,
    }
