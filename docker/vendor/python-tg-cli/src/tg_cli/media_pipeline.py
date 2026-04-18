"""Media download/transcript pipeline helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import get_media_dir


def should_process_incoming_media(message_state: dict, *, owner_id: int) -> bool:
    if not message_state.get("has_media"):
        return False
    if message_state.get("sender_id") == owner_id:
        return False
    return message_state.get("message_kind") in {"voice", "video_note"}


def build_owner_transcript_text(
    *,
    chat_name: str,
    sender_name: str,
    msg_id: int,
    transcript_text: str,
    file_path: str | Path,
) -> str:
    return (
        f"[Auto transcript]\n"
        f"Chat: {chat_name}\n"
        f"Sender: {sender_name}\n"
        f"Message ID: {msg_id}\n"
        f"File: {file_path}\n\n"
        f"{transcript_text}"
    )


async def handle_media_message(
    telegram_client: Any,
    db: Any,
    *,
    raw_msg: Any,
    message_state: dict,
    owner_id: int,
    dialog_type: str,
    stt_client: Any,
):
    if not message_state.get("has_media"):
        return None
    if message_state.get("message_kind") not in {"voice", "video_note"}:
        return None
    if dialog_type != "user":
        return None

    media_dir = get_media_dir()
    file_path = await telegram_client.download_media(raw_msg, file=str(media_dir))
    asset_id = db.insert_media_asset(
        chat_id=message_state["chat_id"],
        msg_id=message_state["msg_id"],
        media_kind=message_state["message_kind"],
        mime_type=None,
        size_bytes=None,
        file_path=file_path,
        downloaded_at=datetime.now(timezone.utc).isoformat(),
        sha256=None,
        status="downloaded",
        error=None,
    )
    transcript = stt_client.transcribe(Path(file_path))
    db.insert_media_transcript(
        chat_id=message_state["chat_id"],
        msg_id=message_state["msg_id"],
        asset_id=asset_id,
        engine="stt-http",
        language=None,
        transcript_text=transcript.get("text"),
        segments_json=transcript.get("segments", []),
        confidence=None,
        created_at=datetime.now(timezone.utc).isoformat(),
        sent_to_owner_at=None if message_state.get("sender_id") == owner_id else datetime.now(timezone.utc).isoformat(),
        status="completed",
        error=None,
    )
    if message_state.get("sender_id") != owner_id:
        owner_text = build_owner_transcript_text(
            chat_name=message_state.get("chat_name") or str(message_state.get("chat_id")),
            sender_name=message_state.get("sender_name") or "Unknown",
            msg_id=message_state["msg_id"],
            transcript_text=transcript.get("text") or "",
            file_path=file_path,
        )
        await telegram_client.send_message("me", owner_text)
    return {
        "asset_id": asset_id,
        "file_path": file_path,
        "transcript": transcript.get("text"),
    }
