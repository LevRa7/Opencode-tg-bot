"""TDD tests for runtime media download/transcription flow."""

from __future__ import annotations

from pathlib import Path

import pytest

from tg_cli.media_pipeline import build_owner_transcript_text, handle_media_message
from tg_cli.db import MessageDB


class _FakeTelegramClient:
    def __init__(self):
        self.downloads = []
        self.sent = []

    async def download_media(self, raw_msg, file):
        path = Path(file) / "audio.ogg"
        self.downloads.append((raw_msg, str(path)))
        return str(path)

    async def send_message(self, target, text):
        self.sent.append((target, text))
        return {"ok": True}


class _FakeSTT:
    def transcribe(self, path: Path):
        return {"text": "привет это голосовуха", "segments": []}


@pytest.mark.asyncio
async def test_incoming_personal_voice_downloads_transcribes_and_sends_owner_dm(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    monkeypatch.setenv("DB_PATH", str(db_path))
    client = _FakeTelegramClient()
    message_state = {
        "chat_id": 100,
        "chat_name": "Снежана",
        "msg_id": 2,
        "sender_id": 10,
        "sender_name": "Снежана",
        "message_kind": "voice",
        "has_media": True,
    }
    result = await handle_media_message(
        client,
        db,
        raw_msg=object(),
        message_state=message_state,
        owner_id=999,
        dialog_type="user",
        stt_client=_FakeSTT(),
    )
    assert result is not None
    assert client.downloads
    assert client.sent
    assert db.list_media_assets(chat_id=100)
    assert db.list_media_transcripts(chat_id=100)


@pytest.mark.asyncio
async def test_outgoing_personal_voice_transcribes_but_does_not_send_owner_dm(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    monkeypatch.setenv("DB_PATH", str(db_path))
    client = _FakeTelegramClient()
    message_state = {
        "chat_id": 100,
        "chat_name": "Снежана",
        "msg_id": 3,
        "sender_id": 999,
        "sender_name": "Лев",
        "message_kind": "voice",
        "has_media": True,
    }
    result = await handle_media_message(
        client,
        db,
        raw_msg=object(),
        message_state=message_state,
        owner_id=999,
        dialog_type="user",
        stt_client=_FakeSTT(),
    )
    assert result is not None
    assert client.downloads
    assert client.sent == []
    assert db.list_media_transcripts(chat_id=100)


@pytest.mark.asyncio
async def test_group_or_channel_media_is_ignored(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    monkeypatch.setenv("DB_PATH", str(db_path))
    client = _FakeTelegramClient()
    message_state = {
        "chat_id": 100,
        "chat_name": "GroupChat",
        "msg_id": 4,
        "sender_id": 10,
        "sender_name": "Other",
        "message_kind": "voice",
        "has_media": True,
    }
    result = await handle_media_message(
        client,
        db,
        raw_msg=object(),
        message_state=message_state,
        owner_id=999,
        dialog_type="group",
        stt_client=_FakeSTT(),
    )
    assert result is None
    assert client.downloads == []
    assert client.sent == []
