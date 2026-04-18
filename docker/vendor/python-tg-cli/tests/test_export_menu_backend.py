"""TDD tests for bot-facing export menu backend."""

from __future__ import annotations

from tg_cli.export_config_service import ExportConfigService
from tg_cli.export_menu_backend import ExportMenuBackend
from tg_cli.db import MessageDB


def _seed_chats(db: MessageDB):
    db.insert_message(chat_id=1, chat_name="Alice", msg_id=1, sender_id=1, sender_name="Alice", content="hello", timestamp=__import__("datetime").datetime.fromisoformat("2026-01-01T00:00:00+00:00"))
    db.insert_message(chat_id=2, chat_name="BotA", msg_id=1, sender_id=2, sender_name="BotA", content="bot", timestamp=__import__("datetime").datetime.fromisoformat("2026-01-01T00:00:00+00:00"))
    db.insert_message(chat_id=3, chat_name="GroupA", msg_id=1, sender_id=3, sender_name="GroupA", content="group", timestamp=__import__("datetime").datetime.fromisoformat("2026-01-01T00:00:00+00:00"))
    db.insert_message(chat_id=4, chat_name="ChannelA", msg_id=1, sender_id=4, sender_name="ChannelA", content="channel", timestamp=__import__("datetime").datetime.fromisoformat("2026-01-01T00:00:00+00:00"))


def test_menu_backend_returns_default_groups(db: MessageDB):
    _seed_chats(db)
    service = ExportConfigService(db)
    backend = ExportMenuBackend(db, service)
    menu = backend.get_root_menu("owner-1")
    labels = {item["scope_name"] for item in menu["groups"]}
    assert "personal" in labels
    assert "bots" in labels
    assert "group_chats" in labels
    assert "public_channels" in labels
    assert "interlocutor_channels" in labels


def test_menu_backend_returns_media_and_time_preferences(db: MessageDB):
    service = ExportConfigService(db)
    service.ensure_default_profile("owner-1")
    service.update_profile(
        "owner-1",
        include_media=True,
        media_kinds=["voice", "video_note"],
        max_file_size_bytes=30 * 1024 * 1024,
        since_ts="2026-01-01T00:00:00+00:00",
        until_ts="2026-02-01T00:00:00+00:00",
    )
    backend = ExportMenuBackend(db, service)
    menu = backend.get_root_menu("owner-1")
    assert menu["preferences"]["include_media"] is True
    assert menu["preferences"]["media_kinds"] == ["voice", "video_note"]


def test_menu_backend_returns_chat_toggle_states_for_scope(db: MessageDB):
    _seed_chats(db)
    service = ExportConfigService(db)
    service.ensure_default_profile("owner-1")
    service.set_chat_enabled("owner-1", chat_id=1, scope_name="personal", enabled=False)
    backend = ExportMenuBackend(db, service)
    scope = backend.get_scope_menu("owner-1", "personal")
    assert scope["scope_name"] == "personal"
    assert any(item["chat_id"] == 1 and item["enabled"] is False for item in scope["chats"])
