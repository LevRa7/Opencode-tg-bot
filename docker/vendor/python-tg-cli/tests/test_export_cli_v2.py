"""TDD tests for export CLI with media filters and absolute time range."""

from __future__ import annotations

import json
from pathlib import Path

import yaml
from click.testing import CliRunner

from tg_cli.cli.main import cli
from tg_cli.db import MessageDB


def _seed(db: MessageDB):
    db.insert_message(
        chat_id=100,
        chat_name="TestChat",
        msg_id=1,
        sender_id=1,
        sender_name="Alice",
        content="hello text",
        timestamp=__import__("datetime").datetime.fromisoformat("2026-01-01T10:00:00+00:00"),
    )
    db.insert_message(
        chat_id=100,
        chat_name="TestChat",
        msg_id=2,
        sender_id=1,
        sender_name="Alice",
        content="voice note",
        timestamp=__import__("datetime").datetime.fromisoformat("2026-01-01T10:01:00+00:00"),
        message_kind="voice",
        has_media=True,
        raw_json={"media": {"kind": "voice", "size": 1024}},
    )


def test_export_default_remains_text_only(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    _seed(db)
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
    runner = CliRunner()
    out = tmp_path / "out.json"
    result = runner.invoke(cli, ["export", "TestChat", "-f", "json", "-o", str(out)])
    assert result.exit_code == 0
    data = json.loads(out.read_text())
    assert len(data) == 1
    assert data[0]["msg_id"] == 1


def test_export_voice_filter_can_include_media(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    _seed(db)
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
    runner = CliRunner()
    out = tmp_path / "out.yaml"
    result = runner.invoke(
        cli,
        ["export", "TestChat", "-f", "yaml", "-o", str(out), "--media", "voice"],
    )
    assert result.exit_code == 0
    data = yaml.safe_load(out.read_text())
    assert len(data) == 1


def test_export_since_until_filters_cli(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    _seed(db)
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
    runner = CliRunner()
    out = tmp_path / "out.json"
    result = runner.invoke(
        cli,
        [
            "export",
            "TestChat",
            "-f",
            "json",
            "-o",
            str(out),
            "--since",
            "2026-01-01T10:00:30+00:00",
            "--until",
            "2026-01-01T10:02:00+00:00",
            "--media",
            "voice",
        ],
    )
    assert result.exit_code == 0
    data = json.loads(out.read_text())
    assert len(data) == 1
    assert data[0]["msg_id"] == 2
