"""TDD tests for persistent export/sync configuration backend."""

from __future__ import annotations

from tg_cli.db import MessageDB


def test_export_config_tables_exist(db: MessageDB):
    table_names = {
        row[0]
        for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "export_config_profiles" in table_names
    assert "export_scope_defaults" in table_names
    assert "export_chat_overrides" in table_names


def test_can_store_and_read_user_export_defaults(db: MessageDB):
    db.upsert_export_config_profile(
        user_id="owner-1",
        default_scope="personal",
        include_media=False,
        media_kinds_json=[],
        max_file_size_bytes=20 * 1024 * 1024,
        since_ts=None,
        until_ts=None,
        updated_at="2026-04-04T00:00:00+00:00",
    )
    profile = db.get_export_config_profile("owner-1")
    assert profile["default_scope"] == "personal"
    assert profile["include_media"] == 0


def test_scope_defaults_roundtrip(db: MessageDB):
    db.upsert_export_scope_default(user_id="owner-1", scope_name="personal", enabled=True)
    db.upsert_export_scope_default(user_id="owner-1", scope_name="all_channels", enabled=False)
    rows = db.list_export_scope_defaults("owner-1")
    assert any(row["scope_name"] == "personal" and row["enabled"] == 1 for row in rows)
    assert any(row["scope_name"] == "all_channels" and row["enabled"] == 0 for row in rows)


def test_chat_overrides_roundtrip(db: MessageDB):
    db.upsert_export_chat_override(
        user_id="owner-1",
        chat_id=731038050,
        scope_name="personal",
        enabled=True,
        updated_at="2026-04-04T00:00:00+00:00",
    )
    rows = db.list_export_chat_overrides("owner-1")
    assert rows[0]["chat_id"] == 731038050
    assert rows[0]["enabled"] == 1


def test_effective_export_config_can_merge_defaults_and_overrides(db: MessageDB):
    db.upsert_export_config_profile(
        user_id="owner-1",
        default_scope="personal",
        include_media=False,
        media_kinds_json=[],
        max_file_size_bytes=20 * 1024 * 1024,
        since_ts=None,
        until_ts=None,
        updated_at="2026-04-04T00:00:00+00:00",
    )
    db.upsert_export_scope_default(user_id="owner-1", scope_name="personal", enabled=True)
    db.upsert_export_scope_default(user_id="owner-1", scope_name="group_chats", enabled=False)
    db.upsert_export_chat_override(
        user_id="owner-1",
        chat_id=100,
        scope_name="group_chats",
        enabled=True,
        updated_at="2026-04-04T00:00:00+00:00",
    )
    config = db.get_effective_export_config("owner-1")
    assert config["profile"]["default_scope"] == "personal"
    assert config["scopes"]["personal"] is True
    assert config["chat_overrides"][100]["enabled"] is True
