"""TDD tests for media transcription pipeline."""

from __future__ import annotations

import json
from pathlib import Path

from tg_cli.media_pipeline import should_process_incoming_media, build_owner_transcript_text
from tg_cli.transcription import STTClient


def test_should_process_incoming_voice_and_video_note_only():
    assert should_process_incoming_media({"message_kind": "voice", "has_media": True, "sender_id": 1}, owner_id=2) is True
    assert should_process_incoming_media({"message_kind": "video_note", "has_media": True, "sender_id": 1}, owner_id=2) is True
    assert should_process_incoming_media({"message_kind": "image", "has_media": True, "sender_id": 1}, owner_id=2) is False
    assert should_process_incoming_media({"message_kind": "voice", "has_media": True, "sender_id": 2}, owner_id=2) is False


def test_build_owner_transcript_text_contains_chat_sender_and_text():
    text = build_owner_transcript_text(
        chat_name="Снежана",
        sender_name="Снежана",
        msg_id=218149,
        transcript_text="Привет, это голосовуха",
        file_path="/tmp/media/audio.ogg",
    )
    assert "Снежана" in text
    assert "218149" in text
    assert "Привет, это голосовуха" in text


def test_stt_client_parses_http_response(monkeypatch):
    class FakeResponse:
        def read(self):
            return json.dumps({"text": "расшифровка готова", "segments": []}).encode()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: FakeResponse())
    client = STTClient(endpoint="http://127.0.0.1:9000/transcribe")
    payload = client.transcribe(Path("/tmp/audio.ogg"))
    assert payload["text"] == "расшифровка готова"
