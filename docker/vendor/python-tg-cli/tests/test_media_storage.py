"""TDD tests for media storage schema and config helpers."""

from __future__ import annotations

from pathlib import Path

from tg_cli.config import get_media_dir, get_stt_endpoint
from tg_cli.db import MessageDB


def test_media_dir_is_created_next_to_db(tmp_path, monkeypatch):
    db_path = tmp_path / "messages.db"
    monkeypatch.setenv("DB_PATH", str(db_path))
    media_dir = get_media_dir()
    assert media_dir.name == "media"
    assert media_dir.parent == db_path.parent


def test_stt_endpoint_can_be_read_from_env(monkeypatch):
    monkeypatch.setenv("STT_ENDPOINT", "http://127.0.0.1:9000/transcribe")
    assert get_stt_endpoint() == "http://127.0.0.1:9000/transcribe"


def test_media_and_transcript_tables_exist(db: MessageDB):
    table_names = {
        row[0]
        for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "media_assets" in table_names
    assert "media_transcripts" in table_names


def test_media_asset_and_transcript_roundtrip(db: MessageDB):
    asset_id = db.insert_media_asset(
        chat_id=100,
        msg_id=2,
        media_kind="voice",
        mime_type="audio/ogg",
        size_bytes=1024,
        file_path="/tmp/media/audio.ogg",
        downloaded_at="2026-04-04T00:00:00+00:00",
        sha256=None,
        status="downloaded",
        error=None,
    )
    db.insert_media_transcript(
        chat_id=100,
        msg_id=2,
        asset_id=asset_id,
        engine="stt-http",
        language="ru",
        transcript_text="привет мир",
        segments_json=[],
        confidence=0.9,
        created_at="2026-04-04T00:01:00+00:00",
        sent_to_owner_at=None,
        status="completed",
        error=None,
    )
    assets = db.list_media_assets(chat_id=100)
    transcripts = db.list_media_transcripts(chat_id=100)
    assert assets[0]["media_kind"] == "voice"
    assert transcripts[0]["transcript_text"] == "привет мир"
