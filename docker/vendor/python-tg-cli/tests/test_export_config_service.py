"""TDD tests for export config service layer used by future bot UI."""

from __future__ import annotations

from tg_cli.export_config_service import ExportConfigService
from tg_cli.db import MessageDB


def test_service_can_initialize_default_profile(db: MessageDB):
    service = ExportConfigService(db)
    profile = service.ensure_default_profile("owner-1")
    assert profile["default_scope"] == "personal"
    assert profile["include_media"] is False


def test_service_can_toggle_scope(db: MessageDB):
    service = ExportConfigService(db)
    service.ensure_default_profile("owner-1")
    service.set_scope_enabled("owner-1", "all_channels", True)
    config = service.get_effective_config("owner-1")
    assert config["scopes"]["all_channels"] is True


def test_service_can_toggle_chat(db: MessageDB):
    service = ExportConfigService(db)
    service.ensure_default_profile("owner-1")
    service.set_chat_enabled("owner-1", chat_id=731038050, scope_name="personal", enabled=False)
    config = service.get_effective_config("owner-1")
    assert config["chat_overrides"][731038050]["enabled"] is False


def test_service_can_update_media_and_time_preferences(db: MessageDB):
    service = ExportConfigService(db)
    service.ensure_default_profile("owner-1")
    service.update_profile(
        "owner-1",
        include_media=True,
        media_kinds=["voice", "video_note"],
        max_file_size_bytes=50 * 1024 * 1024,
        since_ts="2026-01-01T00:00:00+00:00",
        until_ts="2026-02-01T00:00:00+00:00",
    )
    profile = service.get_effective_config("owner-1")["profile"]
    assert profile["include_media"] is True
    assert profile["media_kinds_json"] == ["voice", "video_note"]
    assert profile["max_file_size_bytes"] == 50 * 1024 * 1024
