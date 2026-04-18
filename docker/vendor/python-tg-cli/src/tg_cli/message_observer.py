"""Observe message state changes and persist event-sourced history."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .db import MessageDB


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_message_state(
    *,
    chat_id: int,
    chat_name: str | None,
    msg_id: int,
    sender_id: int | None,
    sender_name: str | None,
    content: str | None,
    timestamp: str,
    reply_to_msg_id: int | None,
    message_kind: str,
    has_media: bool,
    raw_json: dict[str, Any] | None,
) -> dict[str, Any]:
    observed_at = _iso_now()
    raw_json = raw_json or {}
    return {
        "chat_id": chat_id,
        "chat_name": chat_name,
        "msg_id": msg_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "content": content,
        "timestamp": timestamp,
        "reply_to_msg_id": reply_to_msg_id,
        "message_kind": message_kind,
        "has_media": has_media,
        "is_forwarded": bool(raw_json.get("forward")),
        "forwarded_from_id": (raw_json.get("forward") or {}).get("from_id"),
        "forwarded_from_name": (raw_json.get("forward") or {}).get("from_name"),
        "forwarded_date": (raw_json.get("forward") or {}).get("date"),
        "edit_date": raw_json.get("edit_date"),
        "is_deleted": False,
        "deleted_at": None,
        "first_observed_at": observed_at,
        "last_observed_at": observed_at,
        "read_state": None,
        "first_observed_read_at": None,
        "reaction_count": 0,
        "emoji_summary": None,
        "version_count": 1,
        "raw_json": raw_json,
    }


def observe_message_create(db: MessageDB, message_state: dict[str, Any]) -> bool:
    existing = db.get_message(message_state["chat_id"], message_state["msg_id"])
    if existing is not None:
        return False
    db.upsert_message_state(message_state)
    db.insert_message_version(
        chat_id=message_state["chat_id"],
        msg_id=message_state["msg_id"],
        version_no=1,
        content=message_state.get("content"),
        observed_at=message_state["first_observed_at"],
        edit_date=message_state.get("edit_date"),
        raw_json=message_state.get("raw_json"),
    )
    db.insert_message_event(
        chat_id=message_state["chat_id"],
        msg_id=message_state["msg_id"],
        actor_id=str(message_state.get("sender_id")) if message_state.get("sender_id") is not None else None,
        event_type="created",
        event_ts=message_state["first_observed_at"],
        payload_json={"message_kind": message_state.get("message_kind")},
    )
    return True


def observe_message_update(db: MessageDB, message_state: dict[str, Any]) -> str:
    existing = db.get_message(message_state["chat_id"], message_state["msg_id"])
    if existing is None:
        observe_message_create(db, message_state)
        return "created"

    changed_content = (existing.get("content") or "") != (message_state.get("content") or "")
    changed_edit_date = (existing.get("edit_date") or "") != (message_state.get("edit_date") or "")
    import json
    expected_raw = json.dumps(message_state.get("raw_json"), ensure_ascii=False) if message_state.get("raw_json") is not None else ""
    changed_raw = (existing.get("raw_json") or "") != expected_raw

    next_version = int(existing.get("version_count") or 1)
    if changed_content or changed_edit_date or changed_raw:
        next_version += 1
        message_state["version_count"] = next_version
        db.insert_message_version(
            chat_id=message_state["chat_id"],
            msg_id=message_state["msg_id"],
            version_no=next_version,
            content=message_state.get("content"),
            observed_at=message_state["last_observed_at"],
            edit_date=message_state.get("edit_date"),
            raw_json=message_state.get("raw_json"),
        )
        db.insert_message_event(
            chat_id=message_state["chat_id"],
            msg_id=message_state["msg_id"],
            actor_id=str(message_state.get("sender_id")) if message_state.get("sender_id") is not None else None,
            event_type="edited",
            event_ts=message_state["last_observed_at"],
            payload_json={
                "previous_content": existing.get("content"),
                "new_content": message_state.get("content"),
                "previous_edit_date": existing.get("edit_date"),
                "new_edit_date": message_state.get("edit_date"),
            },
        )
        message_state["first_observed_at"] = existing.get("first_observed_at")
        db.upsert_message_state(message_state)
        return "edited"

    message_state["version_count"] = int(existing.get("version_count") or 1)
    message_state["first_observed_at"] = existing.get("first_observed_at")
    db.upsert_message_state(message_state)
    return "unchanged"


def observe_message_delete(db: MessageDB, *, chat_id: int, msg_id: int, actor_id: str | None = None) -> None:
    deleted_at = _iso_now()
    db.mark_message_deleted(chat_id, msg_id, deleted_at=deleted_at)
    db.insert_message_event(
        chat_id=chat_id,
        msg_id=msg_id,
        actor_id=actor_id,
        event_type="deleted",
        event_ts=deleted_at,
        payload_json=None,
    )


def observe_message_read(
    db: MessageDB,
    *,
    chat_id: int,
    msg_id: int,
    direction: str,
    source: str,
    confidence: float = 0.5,
) -> None:
    read_at = _iso_now()
    db.record_message_read(
        chat_id=chat_id,
        msg_id=msg_id,
        direction=direction,
        first_observed_read_at=read_at,
        source=source,
        confidence=confidence,
    )
    db.insert_message_event(
        chat_id=chat_id,
        msg_id=msg_id,
        event_type="read_observed",
        event_ts=read_at,
        payload_json={"direction": direction, "source": source, "confidence": confidence},
    )


def observe_message_reactions(
    db: MessageDB,
    *,
    chat_id: int,
    msg_id: int,
    reactions: list[dict[str, Any]],
) -> None:
    observed_at = _iso_now()
    db.replace_message_reactions(
        chat_id=chat_id,
        msg_id=msg_id,
        reactions=reactions,
        observed_at=observed_at,
    )
    db.insert_message_event(
        chat_id=chat_id,
        msg_id=msg_id,
        event_type="reaction_changed",
        event_ts=observed_at,
        payload_json={"reactions": reactions},
    )
