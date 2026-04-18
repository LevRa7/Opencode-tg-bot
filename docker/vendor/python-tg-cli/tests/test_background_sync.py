"""Tests for background sync orchestration."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import pytest

from tg_cli.background_sync import listen_with_heartbeat, run_background_sync


@pytest.mark.asyncio
async def test_listen_with_heartbeat_updates_sync_state_for_selected_chat(db):
    async def fake_listen(client, chats=None, db=None):
        assert chats == [100]
        assert db is not None
        await asyncio.sleep(0.03)
        return "stopped"

    result = await listen_with_heartbeat(
        object(),
        chats=[100],
        db=db,
        listen_fn=fake_listen,
        heartbeat_seconds=0.01,
    )

    assert result == "stopped"
    state = db.get_sync_state(100)
    assert state is not None
    assert state["last_listener_heartbeat_at"] is not None


@pytest.mark.asyncio
async def test_run_background_sync_retries_until_listener_stops(db):
    calls: list[tuple[int, ...]] = []
    sleeps: list[int] = []

    @asynccontextmanager
    async def fake_connect():
        yield object()

    async def fake_listen(client, chats=None, db=None):
        calls.append(tuple(chats or []))
        return "disconnected" if len(calls) == 1 else "stopped"

    result = await run_background_sync(
        chats=[100],
        retry_seconds=2,
        heartbeat_seconds=0.01,
        db=db,
        connect_fn=fake_connect,
        listen_fn=fake_listen,
        sleep_fn=lambda seconds: sleeps.append(seconds),
    )

    assert result == "stopped"
    assert calls == [(100,), (100,)]
    assert sleeps == [2]
    state = db.get_sync_state(100)
    assert state is not None
    assert state["last_listener_heartbeat_at"] is not None


@pytest.mark.asyncio
async def test_run_background_sync_stops_on_auth_error(db):
    @asynccontextmanager
    async def fake_connect():
        raise RuntimeError("SessionPasswordNeededError")
        yield object()

    async def fake_listen(client, chats=None, db=None):
        raise AssertionError("listen should not run")

    with pytest.raises(RuntimeError):
        await run_background_sync(
            chats=[100],
            retry_seconds=2,
            heartbeat_seconds=0.01,
            db=db,
            connect_fn=fake_connect,
            listen_fn=fake_listen,
            sleep_fn=lambda seconds: (_ for _ in ()).throw(AssertionError("sleep should not run")),
        )
