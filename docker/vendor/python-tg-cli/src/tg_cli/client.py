"""Telegram client with connection reuse and entity caching."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import random
import struct
import zlib
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from telethon import TelegramClient, events
from telethon.errors import AuthKeyUnregisteredError, FloodWaitError, SessionPasswordNeededError
from telethon.sessions import StringSession
from telethon.tl.types import Channel, Chat, MessageMediaDocument, MessageMediaPhoto, User

from .config import (
    get_api_hash,
    get_api_id,
    get_session_path,
    get_stt_endpoint,
    get_token_path,
    is_default_api_id,
)
from .console import console
from .db import MessageDB
from .media_pipeline import handle_media_message
from .message_observer import build_message_state, observe_message_update
from .qrcodegen import QrCode
from .transcription import STTClient

log = logging.getLogger(__name__)

_DEVICE_MODEL = "Desktop"
_SYSTEM_VERSION = "macOS 15.3"
_APP_VERSION = "5.12.1"
_LANG_CODE = "en"
_SYSTEM_LANG_CODE = "en-US"

_FIRST_SYNC_LIMIT = 500


def _get_sender_name(sender: User | Channel | Chat | None) -> str | None:
    if sender is None:
        return None
    if isinstance(sender, User):
        parts = [sender.first_name or "", sender.last_name or ""]
        name = " ".join(p for p in parts if p)
        return name or sender.username or str(sender.id)
    return getattr(sender, "title", None) or str(sender.id)


def _to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _serialize_entities(entities: list[Any] | None) -> list[dict[str, Any]]:
    if not entities:
        return []
    result = []
    for entity in entities:
        entity_dict = {
            "type": entity.__class__.__name__,
            "offset": getattr(entity, "offset", None),
            "length": getattr(entity, "length", None),
        }
        for attr in ("url", "user_id", "language", "document_id", "custom_emoji_id"):
            value = getattr(entity, attr, None)
            if value is not None:
                entity_dict[attr] = value
        result.append(entity_dict)
    return result


def _extract_media_descriptor(msg: Any) -> dict[str, Any] | None:
    media = getattr(msg, "media", None)
    if media is None:
        return None
    descriptor: dict[str, Any] = {
        "type": media.__class__.__name__,
        "has_media": True,
    }
    if isinstance(media, MessageMediaPhoto):
        descriptor["kind"] = "photo"
        photo = getattr(media, "photo", None)
        if photo is not None:
            descriptor["photo_id"] = getattr(photo, "id", None)
    elif isinstance(media, MessageMediaDocument):
        descriptor["kind"] = "document"
        document = getattr(media, "document", None)
        if document is not None:
            descriptor["document_id"] = getattr(document, "id", None)
            descriptor["mime_type"] = getattr(document, "mime_type", None)
            descriptor["size"] = getattr(document, "size", None)
            descriptor["attributes"] = [attr.__class__.__name__ for attr in getattr(document, "attributes", [])]
    else:
        descriptor["kind"] = media.__class__.__name__.replace("MessageMedia", "").lower()
    return descriptor


def _extract_forward_info(msg: Any) -> dict[str, Any] | None:
    fwd = getattr(msg, "fwd_from", None)
    if fwd is None:
        return None
    return {
        "from_id": str(getattr(fwd, "from_id", None)) if getattr(fwd, "from_id", None) else None,
        "from_name": getattr(fwd, "from_name", None),
        "date": _to_iso(getattr(fwd, "date", None)),
        "channel_post": getattr(fwd, "channel_post", None),
        "saved_from_msg_id": getattr(fwd, "saved_from_msg_id", None),
        "saved_from_peer": str(getattr(fwd, "saved_from_peer", None))
        if getattr(fwd, "saved_from_peer", None)
        else None,
    }


def _extract_reply_to(msg: Any) -> int | None:
    reply_to = getattr(msg, "reply_to", None)
    if reply_to is None:
        return None
    return getattr(reply_to, "reply_to_msg_id", None)


def _message_kind(msg: Any, media_descriptor: dict[str, Any] | None) -> str:
    action = getattr(msg, "action", None)
    if action is not None:
        return "service"
    if media_descriptor is not None:
        return media_descriptor.get("kind", "media")
    if getattr(msg, "poll", None) is not None:
        return "poll"
    return "message"


def _build_raw_message_payload(msg: Any, chat_name: str) -> dict[str, Any]:
    media_descriptor = _extract_media_descriptor(msg)
    return {
        "id": msg.id,
        "chat_name": chat_name,
        "text": msg.text or msg.message or "",
        "date": _to_iso(getattr(msg, "date", None)),
        "edit_date": _to_iso(getattr(msg, "edit_date", None)),
        "sender_id": getattr(msg, "sender_id", None),
        "peer_id": str(getattr(msg, "peer_id", None)) if getattr(msg, "peer_id", None) else None,
        "reply_to_msg_id": _extract_reply_to(msg),
        "forward": _extract_forward_info(msg),
        "grouped_id": getattr(msg, "grouped_id", None),
        "post": bool(getattr(msg, "post", False)),
        "out": bool(getattr(msg, "out", False)),
        "mentioned": bool(getattr(msg, "mentioned", False)),
        "pinned": bool(getattr(msg, "pinned", False)),
        "via_bot_id": getattr(msg, "via_bot_id", None),
        "views": getattr(msg, "views", None),
        "forwards": getattr(msg, "forwards", None),
        "replies": getattr(getattr(msg, "replies", None), "replies", None),
        "entities": _serialize_entities(getattr(msg, "entities", None)),
        "message_kind": _message_kind(msg, media_descriptor),
        "media": media_descriptor,
        "service_action": getattr(getattr(msg, "action", None), "__class__", type(None)).__name__
        if getattr(msg, "action", None) is not None
        else None,
    }


_default_api_warned = False


def _warn_default_api_credentials() -> None:
    global _default_api_warned
    if _default_api_warned or not is_default_api_id():
        return
    _default_api_warned = True
    console.print(
        "[yellow]⚠ Using built-in Telegram Desktop credentials.\n"
        "  This increases the risk of account restrictions.\n"
        "  Configure your own Telegram application credentials via environment variables.[/yellow]"
    )


def _resolve_session_string() -> str | None:
    for path in (Path(get_session_path()), Path(get_token_path())):
        if not path.is_file():
            continue
        token = path.read_text(encoding="utf-8").strip()
        if token:
            return token
    return None


async def _write_session_string(client: TelegramClient) -> None:
    token = client.session.save()
    session_path = Path(get_session_path())
    token_path = Path(get_token_path())
    session_path.write_text(token or "", encoding="utf-8")
    token_path.write_text(token or "", encoding="utf-8")


def _clear_session_state() -> None:
    for path in (Path(get_session_path()), Path(get_token_path())):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _build_client() -> TelegramClient:
    _warn_default_api_credentials()
    api_id = get_api_id()
    api_hash = get_api_hash()
    session_string = _resolve_session_string()
    session = StringSession(session_string) if session_string else StringSession()
    return TelegramClient(
        session,
        api_id,
        api_hash,
        device_model=_DEVICE_MODEL,
        system_version=_SYSTEM_VERSION,
        app_version=_APP_VERSION,
        lang_code=_LANG_CODE,
        system_lang_code=_SYSTEM_LANG_CODE,
    )


@asynccontextmanager
async def _connected_client() -> AsyncGenerator[TelegramClient, None]:
    client = _build_client()
    await client.connect()
    try:
        yield client
    finally:
        await client.disconnect()


def _auth_user_payload(me: Any) -> dict[str, str | int]:
    name = " ".join(part for part in [me.first_name, me.last_name] if part).strip()
    return {
        "id": me.id,
        "name": name,
        "username": me.username or "",
        "first_name": me.first_name or "",
        "last_name": me.last_name or "",
        "phone": me.phone or "",
    }


def _login_qr_path() -> Path:
    return Path(f"{get_session_path()}.login.qr.png")


def _login_state_path() -> Path:
    return Path(f"{get_session_path()}.login.json")


def _write_login_state(payload: dict[str, Any]) -> None:
    _login_state_path().write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _read_login_state() -> dict[str, Any] | None:
    path = _login_state_path()
    if not path.is_file():
        return None
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return None
    return json.loads(raw)


def _clear_login_state() -> None:
    try:
        _login_state_path().unlink()
    except FileNotFoundError:
        pass


def _process_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _write_qr_png(url: str) -> Path:
    qr = QrCode.encode_text(url, QrCode.Ecc.MEDIUM)
    border = 4
    scale = 8
    size = qr.get_size()
    image_size = (size + border * 2) * scale
    rows = bytearray()
    for y in range(image_size):
        rows.append(0)
        module_y = y // scale - border
        for x in range(image_size):
            module_x = x // scale - border
            dark = qr.get_module(module_x, module_y)
            value = 0 if dark else 255
            rows.extend((value, value, value))
    path = _login_qr_path()
    ihdr = struct.pack(">IIBBBBB", image_size, image_size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += _png_chunk(b"IHDR", ihdr)
    png += _png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
    png += _png_chunk(b"IEND", b"")
    path.write_bytes(png)
    return path


async def _emit_qr_ready(callback: Callable[[dict[str, Any]], Any] | None, payload: dict[str, Any]) -> None:
    if callback is None:
        return
    result = callback(payload)
    if inspect.isawaitable(result):
        await result


@asynccontextmanager
async def connect() -> AsyncGenerator[TelegramClient, None]:
    """Async context manager for Telegram client — single connection, reuse within scope."""
    c = _build_client()
    await c.start()
    try:
        await _write_session_string(c)
        yield c
    finally:
        await c.disconnect()


async def begin_phone_login(phone: str) -> dict[str, Any]:
    async with _connected_client() as client:
        if await client.is_user_authorized():
            await _write_session_string(client)
            me = await client.get_me()
            return {"authenticated": True, "user": _auth_user_payload(me)}
        sent_code = await client.send_code_request(phone)
        await _write_session_string(client)
        payload = {
            "authenticated": False,
            "phone": phone,
            "phone_code_hash": sent_code.phone_code_hash,
        }
        timeout = getattr(sent_code, "timeout", None)
        if timeout is not None:
            payload["timeout"] = timeout
        return payload


async def complete_phone_login(phone: str, code: str, phone_code_hash: str) -> dict[str, Any]:
    async with _connected_client() as client:
        if await client.is_user_authorized():
            await _write_session_string(client)
            me = await client.get_me()
            return {"authenticated": True, "user": _auth_user_payload(me)}
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            await _write_session_string(client)
            return {
                "authenticated": False,
                "password_required": True,
                "next_step": "login-password",
            }
        except AuthKeyUnregisteredError:
            await _write_session_string(client)
            return {
                "authenticated": False,
                "auth_key_unregistered": True,
                "next_step": "login-start",
            }
        await _write_session_string(client)
        me = await client.get_me()
        return {"authenticated": True, "user": _auth_user_payload(me)}


async def complete_password_login(password: str) -> dict[str, Any]:
    async with _connected_client() as client:
        if await client.is_user_authorized():
            await _write_session_string(client)
            me = await client.get_me()
            payload = {"authenticated": True, "user": _auth_user_payload(me)}
            _write_login_state({
                "event": "authenticated",
                "authenticated": True,
                "pending": False,
                "password_required": False,
                "user": payload["user"],
            })
            return payload
        try:
            await client.sign_in(password=password)
        except AuthKeyUnregisteredError:
            await _write_session_string(client)
            _write_login_state({
                "event": "auth_key_unregistered",
                "authenticated": False,
                "pending": False,
                "password_required": False,
                "auth_key_unregistered": True,
                "next_step": "login-qr",
            })
            return {
                "authenticated": False,
                "auth_key_unregistered": True,
                "next_step": "login-start",
            }
        await _write_session_string(client)
        me = await client.get_me()
        payload = {"authenticated": True, "user": _auth_user_payload(me)}
        _write_login_state({
            "event": "authenticated",
            "authenticated": True,
            "pending": False,
            "password_required": False,
            "user": payload["user"],
        })
        return payload


async def begin_qr_login() -> dict[str, Any]:
    state = _read_login_state()
    if state and state.get("pending") and _process_alive(state.get("worker_pid")):
        return state
    if state and state.get("authenticated"):
        return state
    _clear_login_state()
    async with _connected_client() as client:
        if await client.is_user_authorized():
            await _write_session_string(client)
            me = await client.get_me()
            payload = {
                "event": "authenticated",
                "authenticated": True,
                "pending": False,
                "password_required": False,
                "user": _auth_user_payload(me),
            }
            _write_login_state(payload)
            return payload
        qr_login = await client.qr_login()
        await _write_session_string(client)
        png_path = _write_qr_png(qr_login.url)
        payload = {
            "event": "qr_ready",
            "authenticated": False,
            "pending": True,
            "password_required": False,
            "qr_version": 1,
            "qr_url": qr_login.url,
            "png_path": str(png_path),
            "expires_at": qr_login.expires.isoformat(),
            "next_step": "status",
        }
        _write_login_state(payload)
        return payload


def complete_qr_login() -> dict[str, Any]:
    state = _read_login_state()
    if state is None:
        return {
            "event": "not_started",
            "authenticated": False,
            "pending": False,
            "password_required": False,
            "next_step": "login-qr",
        }
    if state.get("pending") and not _process_alive(state.get("worker_pid")):
        state = {
            **state,
            "event": "auth_aborted",
            "authenticated": False,
            "pending": False,
            "password_required": False,
            "next_step": "login-qr",
        }
        _write_login_state(state)
    return state


def set_qr_login_state(payload: dict[str, Any]) -> None:
    _write_login_state(payload)


def clear_qr_login_state() -> None:
    _clear_login_state()


async def run_qr_login_worker(*, worker_pid: int | None = None) -> dict[str, Any]:
    async def _on_qr_ready(payload: dict[str, Any]) -> None:
        _write_login_state({**payload, "worker_pid": worker_pid})

    result = await login_with_qr(on_qr_ready=_on_qr_ready)
    _write_login_state({**result, "worker_pid": worker_pid})
    return result


async def login_with_qr(
    *,
    on_qr_ready: Callable[[dict[str, Any]], Any] | None = None,
    wait_timeout: float | None = None,
) -> dict[str, Any]:
    async with _connected_client() as client:
        if await client.is_user_authorized():
            await _write_session_string(client)
            me = await client.get_me()
            return {
                "event": "authenticated",
                "authenticated": True,
                "pending": False,
                "password_required": False,
                "user": _auth_user_payload(me),
            }
        qr_login = await client.qr_login()
        await _write_session_string(client)
        qr_version = 1
        previous_qr_version: int | None = None
        while True:
            png_path = _write_qr_png(qr_login.url)
            payload = {
                "event": "qr_ready" if previous_qr_version is None else "qr_rotated",
                "qr_version": qr_version,
                "authenticated": False,
                "pending": True,
                "password_required": False,
                "qr_url": qr_login.url,
                "png_path": str(png_path),
                "expires_at": qr_login.expires.isoformat(),
                "next_step": "login-qr-complete",
            }
            if previous_qr_version is not None:
                payload["replaces_qr_version"] = previous_qr_version
            await _emit_qr_ready(on_qr_ready, payload)
            try:
                me = await qr_login.wait(timeout=wait_timeout)
            except TimeoutError:
                previous_qr_version = qr_version
                qr_version += 1
                await qr_login.recreate()
                continue
            except SessionPasswordNeededError:
                await _write_session_string(client)
                return {
                    **payload,
                    "event": "password_required",
                    "pending": False,
                    "password_required": True,
                    "next_step": "login-password",
                }
            except AuthKeyUnregisteredError:
                _clear_session_state()
                return {
                    **payload,
                    "event": "auth_key_unregistered",
                    "pending": False,
                    "auth_key_unregistered": True,
                    "next_step": "login-qr",
                }
            await _write_session_string(client)
            return {
                **payload,
                "event": "authenticated",
                "authenticated": True,
                "pending": False,
                "password_required": False,
                "user": _auth_user_payload(me),
            }


async def list_chats(
    client: TelegramClient,
    chat_type: str | None = None,
) -> list[dict]:
    """List all dialogs (chats/groups/channels) the user has joined."""
    results = []
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        t = "unknown"
        if isinstance(entity, User):
            t = "user"
        elif isinstance(entity, Chat):
            t = "group"
        elif isinstance(entity, Channel):
            t = "channel" if entity.broadcast else "supergroup"

        if chat_type and t != chat_type:
            continue

        results.append(
            {
                "id": dialog.id,
                "name": dialog.name,
                "type": t,
                "unread": dialog.unread_count,
            }
        )
    return results


async def get_chat_info(client: TelegramClient, chat: str | int) -> dict | None:
    """Get detailed information about a chat."""
    try:
        entity = await client.get_entity(chat)
    except Exception as e:
        log.debug("get_chat_info failed for %s: %s", chat, e)
        return None

    info: dict[str, str] = {}
    info["Title"] = getattr(entity, "title", None) or getattr(entity, "first_name", "") or str(chat)
    info["ID"] = str(entity.id)

    if isinstance(entity, User):
        info["Type"] = "User"
        info["Username"] = f"@{entity.username}" if entity.username else "—"
        info["Phone"] = entity.phone or "—"
    elif isinstance(entity, Chat):
        info["Type"] = "Group"
        info["Members"] = str(getattr(entity, "participants_count", "?"))
    elif isinstance(entity, Channel):
        info["Type"] = "Channel" if entity.broadcast else "Supergroup"
        info["Username"] = f"@{entity.username}" if entity.username else "—"
        try:
            from telethon.tl.functions.channels import GetFullChannelRequest

            full = await client(GetFullChannelRequest(entity))
            info["Members"] = str(full.full_chat.participants_count or "?")
            if full.full_chat.about:
                info["Description"] = full.full_chat.about[:200]
        except Exception as e:
            info["Members"] = "?"
            log.debug("Failed to get full channel info: %s", e)

    return info


async def fetch_history(
    client: TelegramClient,
    chat: str | int,
    limit: int = 1000,
    db: MessageDB | None = None,
    on_progress: Callable[[int], None] | None = None,
    min_id: int = 0,
    batch_delay: float = 0,
) -> int:
    """Fetch historical messages from a chat and store them in the database."""
    owns_db = db is None
    if db is None:
        db = MessageDB()

    try:
        entity = await client.get_entity(chat)
        chat_name = (
            getattr(entity, "title", None) or getattr(entity, "first_name", None) or str(chat)
        )
        chat_id = entity.id

        sender_cache: dict[int, str] = {}

        batch: list[dict] = []
        inserted_count = 0
        BATCH_SIZE = 200

        async for msg in client.iter_messages(entity, limit=limit, min_id=min_id):
            content = msg.text or msg.message or ""
            media_descriptor = _extract_media_descriptor(msg)
            if content == "" and media_descriptor is None and getattr(msg, "action", None) is None:
                continue

            sender_name = None
            if msg.sender_id:
                if msg.sender_id in sender_cache:
                    sender_name = sender_cache[msg.sender_id]
                else:
                    cached = getattr(msg, "_sender", None) or getattr(msg, "sender", None)
                    if cached:
                        sender_name = _get_sender_name(cached)
                    if sender_name:
                        sender_cache[msg.sender_id] = sender_name

            ts = msg.date
            if ts and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            raw_json = _build_raw_message_payload(msg, chat_name)
            message_state = build_message_state(
                chat_id=chat_id,
                chat_name=chat_name,
                msg_id=msg.id,
                sender_id=msg.sender_id,
                sender_name=sender_name,
                content=content,
                timestamp=(ts or datetime.now(timezone.utc)).isoformat(),
                reply_to_msg_id=raw_json.get("reply_to_msg_id"),
                message_kind=raw_json.get("message_kind", "message"),
                has_media=bool(media_descriptor),
                raw_json=raw_json,
            )
            batch.append(message_state)

            if len(batch) >= BATCH_SIZE:
                for item in batch:
                    result = observe_message_update(db, item)
                    if result == "created":
                        inserted_count += 1
                batch.clear()
                if on_progress:
                    on_progress(inserted_count)
                if batch_delay > 0:
                    jitter = batch_delay * random.uniform(-0.3, 0.3)
                    await asyncio.sleep(batch_delay + jitter)

        if batch:
            for item in batch:
                result = observe_message_update(db, item)
                if result == "created":
                    inserted_count += 1

        db.upsert_sync_state(
            chat_id,
            last_msg_id=db.get_last_msg_id(chat_id),
            last_full_scan_at=datetime.now(timezone.utc).isoformat(),
        )
        return inserted_count
    except FloodWaitError as e:
        console.print(f"[yellow]⚠ Telegram rate limit hit, waiting {e.seconds}s...[/yellow]")
        await asyncio.sleep(e.seconds + random.uniform(1, 3))
        return 0
    finally:
        if owns_db:
            db.close()


async def sync_all(
    client: TelegramClient,
    db: MessageDB,
    limit_per_chat: int = 5000,
    on_chat_done: Callable[[str, int, int], None] | None = None,
    delay: float = 1.0,
    max_chats: int | None = None,
) -> dict[str, int]:
    """Sync all chats in the database using a single connection."""
    results: dict[str, int] = {}
    stored_chats = {c["chat_id"]: c for c in db.get_chats()}
    dialog_cache: dict[int, tuple[object, str]] = {}
    try:
        async for dialog in client.iter_dialogs():
            entity = dialog.entity
            dialog_cache[entity.id] = (entity, dialog.name)
    except Exception as e:
        log.debug("Failed to build dialog cache: %s", e)

    items = list(dialog_cache.items())
    if max_chats is not None:
        items = items[:max_chats]
    total = len(items)

    for idx, (chat_id, (entity, dialog_name)) in enumerate(items):
        chat_info = stored_chats.get(chat_id, {})
        chat_name = chat_info.get("chat_name") or dialog_name or str(chat_id)
        last_id = db.get_last_msg_id(chat_id) or 0

        effective_limit = limit_per_chat
        if last_id == 0 and limit_per_chat > _FIRST_SYNC_LIMIT:
            effective_limit = _FIRST_SYNC_LIMIT
            log.debug("First sync for %s, limiting to %d messages", chat_name, effective_limit)

        try:
            count = await fetch_history(
                client,
                entity,
                limit=effective_limit,
                db=db,
                min_id=last_id,
            )
            results[chat_name] = count
            if on_chat_done:
                on_chat_done(chat_name, count, chat_info.get("msg_count", 0) + count)
        except FloodWaitError as e:
            console.print(
                f"  [yellow]⚠ {chat_name}: rate limited, waiting {e.seconds}s...[/yellow]"
            )
            await asyncio.sleep(e.seconds + random.uniform(1, 3))
            results[chat_name] = 0
        except Exception as e:
            console.print(f"  [red]✗ {chat_name}: {e}[/red]")
            results[chat_name] = 0

        if delay > 0 and idx < total - 1:
            jitter = delay * random.uniform(-0.2, 0.2)
            await asyncio.sleep(delay + jitter)

    return results


async def listen(
    client: TelegramClient,
    chats: list[str | int] | None = None,
    db: MessageDB | None = None,
):
    """Real-time listen for new messages in specified chats (or all chats)."""
    owns_db = db is None
    if db is None:
        db = MessageDB()

    try:
        me = await client.get_me()
        console.print(f"[green]✓[/green] Logged in as [bold]{me.first_name}[/bold] ({me.phone})")
        console.print("[dim]Listening for messages... Press Ctrl+C to stop.[/dim]")

        @client.on(events.NewMessage(chats=chats))
        async def handler(event):
            msg = event.message
            chat = await event.get_chat()
            sender = await event.get_sender()

            chat_name = (
                getattr(chat, "title", None) or getattr(chat, "first_name", None) or "Unknown"
            )
            sender_name = _get_sender_name(sender)
            content = msg.text or msg.message or ""
            raw_json = _build_raw_message_payload(msg, chat_name)

            ts = msg.date
            if ts and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            message_state = build_message_state(
                chat_id=chat.id,
                chat_name=chat_name,
                msg_id=msg.id,
                sender_id=msg.sender_id,
                sender_name=sender_name,
                content=content,
                timestamp=(ts or datetime.now(timezone.utc)).isoformat(),
                reply_to_msg_id=raw_json.get("reply_to_msg_id"),
                message_kind=raw_json.get("message_kind", "message"),
                has_media=bool(raw_json.get("media")),
                raw_json=raw_json,
            )
            observe_message_update(db, message_state)
            db.upsert_sync_state(
                chat.id,
                last_msg_id=msg.id,
                last_listener_heartbeat_at=datetime.now(timezone.utc).isoformat(),
            )
            dialog_type = "user" if isinstance(chat, User) else "group" if isinstance(chat, Chat) else "channel"
            stt_endpoint = get_stt_endpoint()
            if stt_endpoint:
                try:
                    await handle_media_message(
                        client,
                        db,
                        raw_msg=msg,
                        message_state=message_state,
                        owner_id=me.id,
                        dialog_type=dialog_type,
                        stt_client=STTClient(endpoint=stt_endpoint),
                    )
                except Exception as e:
                    log.debug("media pipeline failed for %s/%s: %s", chat.id, msg.id, e)

            time_str = ts.strftime("%H:%M:%S") if ts else "??:??:??"
            console.print(
                f"[dim]{time_str}[/dim] [cyan]{chat_name}[/cyan] | "
                f"[bold]{sender_name or 'Unknown'}[/bold]: {content[:200]}"
            )

        status = "disconnected"
        try:
            await client.run_until_disconnected()
        except KeyboardInterrupt:
            status = "stopped"
            console.print("\n[yellow]Stopped listening.[/yellow]")
        finally:
            db_count = db.count()
            console.print(f"[green]Total messages in DB: {db_count}[/green]")
        return status
    finally:
        if owns_db:
            db.close()
