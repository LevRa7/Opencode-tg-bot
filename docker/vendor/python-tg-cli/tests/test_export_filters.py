"""TDD tests for export filters: media, size, since/until, text-only default."""

from __future__ import annotations

from datetime import datetime, timezone

from tg_cli.export_filters import filter_export_messages, parse_size_limit


def _msg(msg_id: int, content: str, ts: str, **extra) -> dict:
    base = {
        "chat_id": 100,
        "chat_name": "TestChat",
        "msg_id": msg_id,
        "sender_name": "Alice",
        "content": content,
        "timestamp": ts,
        "message_kind": "message",
        "has_media": False,
        "raw_json": None,
    }
    base.update(extra)
    return base


def test_default_export_is_text_only():
    msgs = [
        _msg(1, "hello", "2026-01-01T10:00:00+00:00"),
        _msg(2, "voice", "2026-01-01T10:01:00+00:00", message_kind="voice", has_media=True, media_kind="voice", media_size_bytes=1234),
    ]
    filtered = filter_export_messages(msgs, media_filters=None, max_file_size=None, since=None, until=None)
    assert len(filtered) == 1
    assert filtered[0]["msg_id"] == 1


def test_media_filter_can_select_voice_only():
    msgs = [
        _msg(1, "hello", "2026-01-01T10:00:00+00:00"),
        _msg(2, "voice", "2026-01-01T10:01:00+00:00", message_kind="voice", has_media=True, media_kind="voice", media_size_bytes=1234),
        _msg(3, "image", "2026-01-01T10:02:00+00:00", message_kind="image", has_media=True, media_kind="image", media_size_bytes=999),
    ]
    filtered = filter_export_messages(msgs, media_filters={"voice"}, max_file_size=None, since=None, until=None)
    assert len(filtered) == 1
    assert filtered[0]["msg_id"] == 2


def test_media_filter_applies_max_file_size():
    msgs = [
        _msg(2, "voice", "2026-01-01T10:01:00+00:00", message_kind="voice", has_media=True, media_kind="voice", media_size_bytes=25 * 1024 * 1024),
    ]
    filtered = filter_export_messages(msgs, media_filters={"voice"}, max_file_size=20 * 1024 * 1024, since=None, until=None)
    assert filtered == []


def test_since_until_filters_messages_by_absolute_time():
    msgs = [
        _msg(1, "old", "2026-01-01T10:00:00+00:00"),
        _msg(2, "mid", "2026-01-02T10:00:00+00:00"),
        _msg(3, "new", "2026-01-03T10:00:00+00:00"),
    ]
    filtered = filter_export_messages(
        msgs,
        media_filters=None,
        max_file_size=None,
        since="2026-01-02T00:00:00+00:00",
        until="2026-01-03T00:00:00+00:00",
    )
    assert len(filtered) == 1
    assert filtered[0]["msg_id"] == 2


def test_parse_size_limit_supports_mb_strings():
    assert parse_size_limit("20MB") == 20 * 1024 * 1024
