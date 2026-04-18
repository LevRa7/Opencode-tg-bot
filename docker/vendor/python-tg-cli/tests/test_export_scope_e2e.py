"""TDD tests for end-to-end export scope behavior."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from click.testing import CliRunner

from tg_cli.cli.main import cli
from tg_cli.db import MessageDB


def _seed_scope_db(db: MessageDB):
    db.insert_message(chat_id=1, chat_name='Alice', msg_id=1, sender_id=1, sender_name='Alice', content='hi', timestamp=datetime(2026,1,1,10,0,tzinfo=timezone.utc))
    db.insert_message(chat_id=2, chat_name='GroupA', msg_id=1, sender_id=2, sender_name='GroupA', content='group', timestamp=datetime(2026,1,1,10,1,tzinfo=timezone.utc))
    db.insert_message(chat_id=3, chat_name='ChannelA', msg_id=1, sender_id=3, sender_name='ChannelA', content='channel', timestamp=datetime(2026,1,1,10,2,tzinfo=timezone.utc))


def test_export_scope_all_chats_cli(tmp_path, monkeypatch):
    db_path = tmp_path / 'test.db'
    db = MessageDB(db_path=db_path)
    _seed_scope_db(db)
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, 'get_db_path', lambda: db_path)
    runner = CliRunner()
    out = tmp_path / 'out.json'
    result = runner.invoke(cli, ['export', '--scope', 'all_chats', '-f', 'json', '-o', str(out)])
    assert result.exit_code == 0
    data = json.loads(out.read_text())
    assert len(data) == 3


def test_export_scope_and_chat_conflict_cli(tmp_path, monkeypatch):
    db_path = tmp_path / 'test.db'
    MessageDB(db_path=db_path).close()
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, 'get_db_path', lambda: db_path)
    runner = CliRunner()
    result = runner.invoke(cli, ['export', 'Alice', '--scope', 'all_chats'])
    assert result.exit_code != 0


def test_export_requires_chat_or_scope_cli(tmp_path, monkeypatch):
    db_path = tmp_path / 'test.db'
    MessageDB(db_path=db_path).close()
    import tg_cli.db as db_mod

    monkeypatch.setattr(db_mod, 'get_db_path', lambda: db_path)
    runner = CliRunner()
    result = runner.invoke(cli, ['export'])
    assert result.exit_code != 0
