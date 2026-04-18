"""TDD tests for debug/inspection CLI commands."""

from __future__ import annotations

import yaml

from click.testing import CliRunner

from tg_cli.cli.main import cli
from tg_cli.assertion_resolver import apply_observation
from tg_cli.db import MessageDB
from conftest import make_msg


def test_projection_command_yaml(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    db.insert_message(**make_msg(msg_id=1, content="Привет"))
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
    runner = CliRunner()
    result = runner.invoke(cli, ["projection", "TestChat", "Что происходит?", "--yaml"])
    assert result.exit_code == 0
    data = yaml.safe_load(result.output)["data"]
    assert data["question"] == "Что происходит?"
    assert "session_meta" in data


def test_subject_show_yaml(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    db.insert_message(**make_msg(msg_id=1, content="Привет"))
    apply_observation(
        db,
        subject_id="telegram:user:100",
        chat_id=100,
        observation={
            "field": "work",
            "value": "бариста",
            "confidence": 1.0,
            "observed_at": "2026-02-01T00:00:00+00:00",
            "source_msg_id": 10,
        },
    )
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
    runner = CliRunner()
    result = runner.invoke(cli, ["subject-show", "TestChat", "--yaml"])
    assert result.exit_code == 0
    data = yaml.safe_load(result.output)["data"]
    assert "active_assertions" in data


def test_events_command_yaml(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    db.insert_message(**make_msg(msg_id=1, content="Привет"))
    db.insert_message_event(chat_id=100, msg_id=1, event_type="created", event_ts="2026-04-04T00:00:00+00:00")
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
    runner = CliRunner()
    result = runner.invoke(cli, ["events", "TestChat", "--yaml"])
    assert result.exit_code == 0
    data = yaml.safe_load(result.output)["data"]
    assert data[0]["event_type"] == "created"


def test_interaction_metrics_command_yaml(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    db = MessageDB(db_path=db_path)
    db.insert_message(**make_msg(msg_id=1, sender_name="Лев", content="Мне плохо", hours_ago=2))
    db.insert_message(**make_msg(msg_id=2, sender_name="Снежана", content="Стрем", hours_ago=1.9))
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
    runner = CliRunner()
    result = runner.invoke(cli, ["interaction-metrics", "TestChat", "--yaml"])
    assert result.exit_code == 0
    data = yaml.safe_load(result.output)["data"]
    assert "metrics" in data
    assert "patterns" in data
