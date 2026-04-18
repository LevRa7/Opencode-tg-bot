"""Background sync orchestration for long-running Telegram listener flows."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from datetime import datetime, timezone
from typing import Any

from .client import connect, listen
from .db import MessageDB

_AUTH_ERROR_MARKERS = (
    "authkey",
    "phonecode",
    "phonenumber",
    "passwordneeded",
    "sessionpassword",
    "sessionrevoked",
    "unauthorized",
)


def _normalize_heartbeat_chat_ids(chats: list[str | int] | None, db: MessageDB) -> list[int]:
    if not chats:
        return [int(row["chat_id"]) for row in db.get_chats() if row.get("chat_id") is not None]

    result: list[int] = []
    for chat in chats:
        if isinstance(chat, int):
            result.append(chat)
            continue
        resolved = db.resolve_chat_id(chat)
        if resolved is not None:
            result.append(resolved)
    return result


async def listen_with_heartbeat(
    client: Any,
    *,
    chats: list[str | int] | None = None,
    db: MessageDB | None = None,
    heartbeat_seconds: float = 30.0,
    listen_fn: Callable[..., Awaitable[str]] = listen,
) -> str:
    owns_db = db is None
    if db is None:
        db = MessageDB()

    heartbeat_chat_ids = _normalize_heartbeat_chat_ids(chats, db)
    initial_ts = datetime.now(timezone.utc).isoformat()
    for chat_id in heartbeat_chat_ids:
        db.upsert_sync_state(chat_id, last_listener_heartbeat_at=initial_ts)

    stop = asyncio.Event()

    async def _heartbeat_loop() -> None:
        while not stop.is_set():
            ts = datetime.now(timezone.utc).isoformat()
            for chat_id in heartbeat_chat_ids:
                db.upsert_sync_state(chat_id, last_listener_heartbeat_at=ts)
            try:
                await asyncio.wait_for(stop.wait(), timeout=heartbeat_seconds)
            except TimeoutError:
                continue

    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    try:
        return await listen_fn(client, chats=chats, db=db)
    finally:
        stop.set()
        await heartbeat_task
        if owns_db:
            db.close()


def _is_auth_error(exc: Exception) -> bool:
    text = f"{exc.__class__.__name__} {exc}".lower().replace("_", "")
    return any(marker in text for marker in _AUTH_ERROR_MARKERS)


async def run_background_sync(
    *,
    chats: list[str | int] | None = None,
    retry_seconds: int = 5,
    heartbeat_seconds: float = 30.0,
    db: MessageDB | None = None,
    connect_fn: Callable[[], AbstractAsyncContextManager[Any]] = connect,
    listen_fn: Callable[..., Awaitable[str]] = listen,
    sleep_fn: Callable[[int], Any] = asyncio.sleep,
) -> str:
    while True:
        try:
            async with connect_fn() as client:
                result = await listen_with_heartbeat(
                    client,
                    chats=chats,
                    db=db,
                    heartbeat_seconds=heartbeat_seconds,
                    listen_fn=listen_fn,
                )
        except Exception as exc:
            if _is_auth_error(exc):
                raise
            await _maybe_await(sleep_fn(retry_seconds))
            continue

        if result == "stopped":
            return result

        await _maybe_await(sleep_fn(retry_seconds))


async def _maybe_await(value: Any) -> Any:
    if asyncio.iscoroutine(value) or isinstance(value, Awaitable):
        return await value
    return value
