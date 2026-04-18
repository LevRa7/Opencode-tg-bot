"""Extract profile/media/repost metadata from Telegram export-like payloads."""

from __future__ import annotations

from typing import Any


def extract_profile_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    first_name = payload.get("first_name") or ""
    last_name = payload.get("last_name") or ""
    display_name = " ".join(part for part in [first_name, last_name] if part).strip() or first_name or last_name
    username = (payload.get("username") or "").lstrip("@") or None
    return {
        "display_name": display_name or None,
        "username": username,
        "bio": payload.get("bio"),
        "avatar_ref": payload.get("photo"),
        "tg_external_id": str(payload.get("user_id")) if payload.get("user_id") is not None else None,
    }


def extract_message_media(payload: dict[str, Any]) -> dict[str, Any]:
    media_type = payload.get("media_type") or payload.get("type") or "unknown"
    if media_type == "audio_file":
        normalized_type = "audio"
    elif media_type in {"video_file", "video"}:
        normalized_type = "video"
    else:
        normalized_type = media_type
    return {
        "media_type": normalized_type,
        "title": payload.get("title"),
        "performer": payload.get("performer"),
        "duration_sec": payload.get("duration_seconds"),
        "file_name": payload.get("file_name"),
        "mime_type": payload.get("mime_type"),
        "caption": payload.get("text") or payload.get("caption"),
    }


def extract_message_repost(payload: dict[str, Any]) -> dict[str, Any]:
    source_name = payload.get("forwarded_from") or payload.get("saved_from")
    source_id = payload.get("forwarded_from_id") or payload.get("saved_from_id")
    source_type = "channel" if payload.get("saved_from") else "user"
    return {
        "source_type": source_type,
        "source_id": source_id,
        "source_name": source_name,
        "forwarded_date": payload.get("date"),
    }
