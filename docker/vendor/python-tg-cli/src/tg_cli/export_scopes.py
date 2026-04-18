"""Helpers for selecting chat IDs by export scope."""

from __future__ import annotations

from typing import Any


def select_scope_chat_ids(db: Any, *, scope: str) -> list[int]:
    chats = db.get_chats()
    if scope == "personal":
        return [chat["chat_id"] for chat in chats if chat.get("chat_type") == "user"]
    if scope == "all_channels":
        return [chat["chat_id"] for chat in chats if chat.get("chat_type") == "channel"]
    if scope == "all_chats":
        return [chat["chat_id"] for chat in chats]
    raise ValueError(f"Unsupported export scope: {scope}")
