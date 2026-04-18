"""Tests for CLI commands — uses CliRunner with temp DB, no Telegram dependency."""

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml
from click.testing import CliRunner

from tg_cli.cli.main import cli
from tg_cli.background_sync import run_background_sync
from tg_cli.db import MessageDB


@pytest.fixture
def runner():
    return CliRunner()


class TestStats:
    def test_stats_output(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["stats"])
        assert result.exit_code == 0
        assert "TestGroup" in result.output
        assert "10" in result.output

    def test_stats_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["stats", "--yaml"])
        assert result.exit_code == 0
        payload = yaml.safe_load(result.output)
        assert payload["ok"] is True
        data = payload["data"]
        assert data["total"] == 10
        assert data["chats"][0]["chat_name"] == "TestGroup"

    def test_stats_auto_yaml_when_stdout_is_not_tty(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        monkeypatch.setenv("OUTPUT", "auto")
        result = runner.invoke(cli, ["stats"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["total"] == 10


class TestSearch:
    def test_search_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "Web3"])
        assert result.exit_code == 0
        assert "Web3" in result.output

    def test_search_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "nonexistent_keyword_xyz"])
        assert result.exit_code == 0
        assert "No messages found" in result.output

    def test_search_with_sender_and_hours(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "Web3", "--sender", "Alice", "--hours", "5"])
        assert result.exit_code == 0
        assert "Found 2 messages" in result.output
        assert "sender=Alice" in result.output
        assert "hours=5" in result.output

    def test_search_chat_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "Web3", "--chat", "MissingGroup"])
        assert result.exit_code == 0
        assert "Chat 'MissingGroup' not found in database." in result.output

    def test_search_chat_not_found_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "Web3", "--chat", "MissingGroup", "--yaml"])
        assert result.exit_code != 0
        payload = yaml.safe_load(result.output)
        assert payload["ok"] is False
        assert payload["error"]["code"] == "chat_not_found"

    def test_search_regex_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(
            cli,
            ["search", r"Message [12]: (Python|Web3)", "--regex", "--limit", "2"],
        )
        assert result.exit_code == 0
        assert "mode=regex" in result.output

    def test_search_regex_invalid(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "(", "--regex"])
        assert result.exit_code == 0
        assert "Invalid regex pattern" in result.output

    def test_search_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "Web3", "--yaml"])
        assert result.exit_code == 0
        payload = yaml.safe_load(result.output)
        assert payload["ok"] is True
        data = payload["data"]
        assert isinstance(data, list)
        assert data[0]["content"]


class TestRecent:
    def test_recent_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["recent", "--hours", "3", "--limit", "3"])
        assert result.exit_code == 0
        assert "Showing 2 recent messages" in result.output
        assert "hours=3" in result.output

    def test_recent_with_sender_filter(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["recent", "--sender", "Ali", "--hours", "5"])
        assert result.exit_code == 0
        assert "sender=Ali" in result.output

    def test_recent_chat_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["recent", "--chat", "MissingGroup"])
        assert result.exit_code == 0
        assert "Chat 'MissingGroup' not found in database." in result.output


class TestQueryChatNotFound:
    def test_today_chat_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["today", "--chat", "MissingGroup"])
        assert result.exit_code == 0
        assert "Chat 'MissingGroup' not found in database." in result.output

    def test_top_chat_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["top", "--chat", "MissingGroup"])
        assert result.exit_code == 0
        assert "Chat 'MissingGroup' not found in database." in result.output

    def test_timeline_chat_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["timeline", "--chat", "MissingGroup"])
        assert result.exit_code == 0
        assert "Chat 'MissingGroup' not found in database." in result.output

    def test_filter_chat_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["filter", "Web3", "--chat", "MissingGroup"])
        assert result.exit_code == 0
        assert "Chat 'MissingGroup' not found in database." in result.output


class TestTodayHints:
    def test_today_shows_refresh_hint_when_local_data_is_old(self, runner, tmp_path, monkeypatch):
        db_path = tmp_path / "test.db"
        db = MessageDB(db_path=db_path)
        db.insert_message(
            chat_id=100,
            chat_name="OldGroup",
            msg_id=1,
            sender_id=1,
            sender_name="Alice",
            content="old message",
            timestamp=datetime(2026, 3, 8, 0, 0, tzinfo=timezone.utc),
        )

        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["today"])
        assert result.exit_code == 0
        assert "No messages today." in result.output
        assert "Latest local message is from" in result.output
        assert "Run 'tg refresh'" in result.output
        assert "refresh." in result.output

    def test_today_shows_empty_db_hint(self, runner, tmp_path, monkeypatch):
        db_path = tmp_path / "test.db"
        MessageDB(db_path=db_path).close()

        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["today"])
        assert result.exit_code == 0
        assert "No messages today." in result.output
        assert "Local database is empty. Run 'tg refresh' first." in result.output


class TestRefreshAndSyncFirst:
    def test_refresh_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        async def fake_sync_all_dialogs(*, limit, on_chat_done=None, delay=1.0, max_chats=None):
            assert limit == 5000
            return {"ChatA": 2, "ChatB": 0}

        monkeypatch.setattr(tg_mod, "sync_all_dialogs", fake_sync_all_dialogs)
        result = runner.invoke(cli, ["refresh", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["new_messages"] == 2
        assert data["updated_chats"] == ["ChatA"]


class TestAuthCommands:
    def test_login_start_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        async def fake_begin_phone_login(phone):
            assert phone == "+123456"
            return {
                "authenticated": False,
                "phone": phone,
                "phone_code_hash": "hash-123",
                "timeout": 30,
            }

        monkeypatch.setattr(tg_mod, "begin_phone_login", fake_begin_phone_login)
        result = runner.invoke(cli, ["login-start", "+123456", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["phone_code_hash"] == "hash-123"
        assert data["timeout"] == 30

    def test_login_complete_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        async def fake_complete_phone_login(phone, code, phone_code_hash):
            assert phone == "+123456"
            assert code == "11111"
            assert phone_code_hash == "hash-123"
            return {
                "authenticated": True,
                "user": {"username": "alice", "id": 123},
            }

        monkeypatch.setattr(tg_mod, "complete_phone_login", fake_complete_phone_login)
        result = runner.invoke(
            cli,
            ["login-complete", "+123456", "11111", "--phone-code-hash", "hash-123", "--yaml"],
        )
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["authenticated"] is True
        assert data["user"]["username"] == "alice"

    def test_login_complete_password_required_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        async def fake_complete_phone_login(phone, code, phone_code_hash):
            return {"authenticated": False, "password_required": True, "next_step": "login-password"}

        monkeypatch.setattr(tg_mod, "complete_phone_login", fake_complete_phone_login)
        result = runner.invoke(
            cli,
            ["login-complete", "+123456", "11111", "--phone-code-hash", "hash-123", "--yaml"],
        )
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["authenticated"] is False
        assert data["password_required"] is True
        assert data["next_step"] == "login-password"

    def test_login_password_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        async def fake_complete_password_login(password):
            assert password == "secret"
            return {
                "authenticated": True,
                "user": {"username": "alice", "id": 123},
            }

        monkeypatch.setattr(tg_mod, "complete_password_login", fake_complete_password_login)
        result = runner.invoke(cli, ["login-password", "--password", "secret", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["authenticated"] is True
        assert data["user"]["username"] == "alice"

    def test_login_password_prompt(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        async def fake_complete_password_login(password):
            assert password == "secret"
            return {
                "authenticated": True,
                "user": {"username": "alice", "id": 123},
            }

        monkeypatch.setattr(tg_mod, "complete_password_login", fake_complete_password_login)
        result = runner.invoke(cli, ["login-password"], input="secret\n")
        assert result.exit_code == 0
        assert "Authenticated" in result.output

    def test_login_qr_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        states = iter(
            [
                {"event": "not_started", "authenticated": False, "pending": False, "password_required": False},
                {
                    "event": "qr_ready",
                    "qr_version": 1,
                    "authenticated": False,
                    "pending": True,
                    "password_required": False,
                    "qr_url": "tg://login?token=abc123",
                    "png_path": "/tmp/test.login.qr.png",
                    "expires_at": "2026-04-08T12:00:00+00:00",
                    "next_step": "status",
                },
            ]
        )

        monkeypatch.setattr(tg_mod, "_spawn_qr_login_worker", lambda: 999)
        monkeypatch.setattr(tg_mod, "clear_qr_login_state", lambda: None)
        monkeypatch.setattr(tg_mod, "complete_qr_login", lambda: next(states))
        result = runner.invoke(cli, ["login-qr", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["event"] == "qr_ready"
        assert data["qr_version"] == 1
        assert data["authenticated"] is False
        assert data["pending"] is True
        assert data["png_path"] == "/tmp/test.login.qr.png"
        assert data["next_step"] == "status"
        assert data["worker_pid"] == 999

    def test_login_qr_wait_json_streams_events(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        async def fake_login_with_qr(*, on_qr_ready=None, wait_timeout=None):
            assert wait_timeout == 15
            assert on_qr_ready is not None
            await on_qr_ready(
                {
                    "event": "qr_ready",
                    "qr_version": 1,
                    "authenticated": False,
                    "pending": True,
                    "password_required": False,
                    "qr_url": "tg://login?token=abc123",
                    "png_path": "/tmp/test.login.qr.png",
                    "expires_at": "2026-04-08T12:00:00+00:00",
                    "next_step": "login-qr-complete",
                }
            )
            return {
                "event": "authenticated",
                "qr_version": 1,
                "authenticated": True,
                "pending": False,
                "password_required": False,
                "qr_url": "tg://login?token=abc123",
                "png_path": "/tmp/test.login.qr.png",
                "expires_at": "2026-04-08T12:00:00+00:00",
                "user": {"username": "alice", "id": 123},
            }

        monkeypatch.setattr(tg_mod, "login_with_qr", fake_login_with_qr)
        result = runner.invoke(cli, ["login-qr", "--wait", "--wait-timeout", "15", "--json"])
        assert result.exit_code == 0
        lines = [json.loads(line) for line in result.output.splitlines() if line.strip()]
        assert [line["data"]["event"] for line in lines] == ["qr_ready", "authenticated"]
        assert all(line["ok"] is True for line in lines)
        assert all(line["schema_version"] == "1" for line in lines)
        assert lines[-1]["data"]["user"]["username"] == "alice"



class TestStatus:
    def test_status_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        class FakeMe:
            id = 123
            first_name = "Alice"
            last_name = "Smith"
            username = "alice"
            phone = "123456"

        class FakeClient:
            async def get_me(self):
                return FakeMe()

        @asynccontextmanager
        async def fake_connect():
            yield FakeClient()

        monkeypatch.setattr(
            tg_mod,
            "complete_qr_login",
            lambda: {"event": "not_started", "authenticated": False, "pending": False, "password_required": False},
        )
        monkeypatch.setattr(tg_mod, "connect", fake_connect)
        result = runner.invoke(cli, ["status", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)
        assert data["ok"] is True
        assert data["schema_version"] == "1"
        assert data["data"]["authenticated"] is True
        assert data["data"]["user"]["username"] == "alice"

    def test_whoami_yaml(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        class FakeMe:
            id = 123
            first_name = "Alice"
            last_name = "Smith"
            username = "alice"
            phone = "123456"

        class FakeClient:
            async def get_me(self):
                return FakeMe()

        @asynccontextmanager
        async def fake_connect():
            yield FakeClient()

        monkeypatch.setattr(tg_mod, "connect", fake_connect)
        result = runner.invoke(cli, ["whoami", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)
        assert data["ok"] is True
        assert data["schema_version"] == "1"
        assert data["data"]["user"]["username"] == "alice"
        assert data["data"]["user"]["name"] == "Alice Smith"

    def test_today_sync_first_refreshes_before_query(self, runner, tmp_path, monkeypatch):
        db_path = tmp_path / "test.db"
        MessageDB(db_path=db_path).close()

        import tg_cli.cli.query as query_mod
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)

        async def fake_sync_all_dialogs(*, limit, on_chat_done=None):
            with MessageDB(db_path=db_path) as db:
                db.insert_message(
                    chat_id=100,
                    chat_name="FreshGroup",
                    msg_id=1,
                    sender_id=1,
                    sender_name="Alice",
                    content="new today",
                    timestamp=datetime.now(timezone.utc),
                )
            return {"FreshGroup": 1}

        monkeypatch.setattr(query_mod, "sync_all_dialogs", fake_sync_all_dialogs)
        result = runner.invoke(cli, ["today", "--sync-first"])
        assert result.exit_code == 0
        assert "FreshGroup" in result.output

    def test_search_sync_first_syncs_single_chat(self, runner, tmp_path, monkeypatch):
        db_path = tmp_path / "test.db"
        MessageDB(db_path=db_path).close()

        import tg_cli.cli.query as query_mod
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)

        async def fake_sync_chat_dialog(chat, *, limit, on_progress=None):
            assert chat == "FreshGroup"
            with MessageDB(db_path=db_path) as db:
                db.insert_message(
                    chat_id=100,
                    chat_name="FreshGroup",
                    msg_id=1,
                    sender_id=1,
                    sender_name="Alice",
                    content="fresh web3 note",
                    timestamp=datetime.now(timezone.utc),
                )
            return 1

        monkeypatch.setattr(query_mod, "sync_chat_dialog", fake_sync_chat_dialog)
        result = runner.invoke(cli, ["search", "web3", "--chat", "FreshGroup", "--sync-first"])
        assert result.exit_code == 0
        assert "fresh web3 note" in result.output

    def test_stats_sync_first_refreshes_before_summary(self, runner, tmp_path, monkeypatch):
        db_path = tmp_path / "test.db"
        MessageDB(db_path=db_path).close()

        import tg_cli.cli.query as query_mod
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)

        async def fake_sync_all_dialogs(*, limit, on_chat_done=None):
            with MessageDB(db_path=db_path) as db:
                db.insert_message(
                    chat_id=100,
                    chat_name="FreshGroup",
                    msg_id=1,
                    sender_id=1,
                    sender_name="Alice",
                    content="fresh web3 note",
                    timestamp=datetime.now(timezone.utc),
                )
            return {"FreshGroup": 1}

        monkeypatch.setattr(query_mod, "sync_all_dialogs", fake_sync_all_dialogs)
        result = runner.invoke(cli, ["stats", "--sync-first", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["total"] == 1
        assert data["chats"][0]["chat_name"] == "FreshGroup"


class TestListenPersist:
    def test_listen_persist_reconnects_until_stopped(self, runner, monkeypatch):
        import tg_cli.cli.tg as tg_mod

        calls: list[tuple[int, ...] | None] = []
        sleeps: list[int] = []

        async def fake_run_background_sync(
            *,
            chats=None,
            retry_seconds,
            heartbeat_seconds=30,
        ):
            calls.append(tuple(chats) if chats is not None else None)
            if len(calls) == 1:
                sleeps.append(retry_seconds)
            return "stopped"

        monkeypatch.setattr(tg_mod, "run_background_sync", fake_run_background_sync)

        result = runner.invoke(cli, ["listen", "--persist", "--retry-seconds", "1", "100"])
        assert result.exit_code == 0
        assert calls == [(100,)]
        assert sleeps == [1]


class TestAmbiguousChat:
    def test_search_ambiguous_chat(self, runner, tmp_path, monkeypatch):
        db_path = tmp_path / "test.db"
        db = MessageDB(db_path=db_path)
        db.insert_message(
            chat_id=100,
            chat_name="Dev Group",
            msg_id=1,
            sender_id=1,
            sender_name="Alice",
            content="hello",
            timestamp=datetime(2026, 3, 10, 0, 0, tzinfo=timezone.utc),
        )
        db.insert_message(
            chat_id=200,
            chat_name="Dev Chat",
            msg_id=2,
            sender_id=2,
            sender_name="Bob",
            content="world",
            timestamp=datetime(2026, 3, 10, 1, 0, tzinfo=timezone.utc),
        )

        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["search", "hello", "--chat", "Dev"])
        assert result.exit_code == 0
        assert "matches multiple local chats" in result.output
        assert "Dev Group" in result.output
        assert "Dev Chat" in result.output


class TestExport:
    def test_export_text(self, runner, populated_db, tmp_path, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        out_file = str(tmp_path / "export.txt")
        result = runner.invoke(cli, ["export", "TestGroup", "-o", out_file])
        assert result.exit_code == 0
        assert "Exported" in result.output

        content = Path(out_file).read_text()
        assert "Alice:" in content

    def test_export_json(self, runner, populated_db, tmp_path, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        out_file = str(tmp_path / "export.json")
        result = runner.invoke(cli, ["export", "TestGroup", "-f", "json", "-o", out_file])
        assert result.exit_code == 0

        data = json.loads(Path(out_file).read_text())
        assert isinstance(data, list)
        assert len(data) > 0

    def test_export_not_found(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["export", "NonexistentGroup"])
        assert result.exit_code == 0
        assert "not found" in result.output

    def test_export_yaml(self, runner, populated_db, tmp_path, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        out_file = str(tmp_path / "export.yaml")
        result = runner.invoke(cli, ["export", "TestGroup", "-f", "yaml", "-o", out_file])
        assert result.exit_code == 0

        data = yaml.safe_load(Path(out_file).read_text())
        assert isinstance(data, list)
        assert data[0]["chat_name"] == "TestGroup"


class TestSessionCommands:
    def test_session_build_and_show_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        build = runner.invoke(cli, ["session-build", "TestGroup", "--yaml"])
        assert build.exit_code == 0
        build_data = yaml.safe_load(build.output)["data"]
        assert build_data["chat_name"] == "TestGroup"
        assert build_data["segment_count"] >= 1
        assert build_data["quality"] == "heuristic-v2"

        show = runner.invoke(cli, ["session-show", "TestGroup", "--yaml"])
        assert show.exit_code == 0
        show_data = yaml.safe_load(show.output)["data"]
        assert show_data["chat_name"] == "TestGroup"
        assert len(show_data["segments"]) >= 1
        assert len(show_data["facts"]) >= 1

    def test_session_segments_and_facts_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        runner.invoke(cli, ["session-build", "TestGroup"])

        segments = runner.invoke(cli, ["session-segments", "TestGroup", "--yaml"])
        assert segments.exit_code == 0
        segment_data = yaml.safe_load(segments.output)["data"]
        assert isinstance(segment_data, list)
        assert segment_data[0]["message_count"] >= 1

        facts = runner.invoke(cli, ["session-facts", "TestGroup", "--yaml"])
        assert facts.exit_code == 0
        fact_data = yaml.safe_load(facts.output)["data"]
        assert isinstance(fact_data, list)
        assert fact_data[0]["evidence"]

    def test_session_compact_and_reset_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        runner.invoke(cli, ["session-build", "TestGroup"])

        compact = runner.invoke(cli, ["session-compact", "TestGroup", "--yaml"])
        assert compact.exit_code == 0
        compact_data = yaml.safe_load(compact.output)["data"]
        assert "compacted" in compact_data

        reset = runner.invoke(cli, ["session-reset", "TestGroup", "--yaml", "--yes"])
        assert reset.exit_code == 0
        reset_data = yaml.safe_load(reset.output)["data"]
        assert reset_data["reset"] is True

    def test_session_show_not_built_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["session-show", "TestGroup", "--yaml"])
        assert result.exit_code != 0
        payload = yaml.safe_load(result.output)
        assert payload["ok"] is False
        assert payload["error"]["code"] == "session_not_built"

    def test_ask_yaml(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)
        result = runner.invoke(cli, ["ask", "TestGroup", "What is going on here?", "--yaml"])
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["chat_name"] == "TestGroup"
        assert "Question about TestGroup" in data["answer"]
        assert data["projection"]
        assert data["prompt"]
        assert data["backend"]["llm_ready"] is True
        assert data["projection"]["evidence"]

    def test_ask_supports_backend_selection(self, runner, populated_db, monkeypatch):
        db, db_path = populated_db
        import tg_cli.db as db_mod
        import tg_cli.cli.session as session_mod

        monkeypatch.setattr(db_mod, "get_db_path", lambda: db_path)

        class FakeClaudeBackend:
            name = "claude"

            def answer(self, projection, prompt):
                return {
                    "backend": {"mode": "claude", "llm_ready": True, "model": "claude-test"},
                    "answer": "Claude response",
                    "prompt": prompt,
                }

        monkeypatch.setattr(session_mod, "get_answer_backend", lambda name=None: FakeClaudeBackend())
        result = runner.invoke(
            cli,
            ["ask", "TestGroup", "What is going on here?", "--backend", "claude", "--yaml"],
        )
        assert result.exit_code == 0
        data = yaml.safe_load(result.output)["data"]
        assert data["backend"]["mode"] == "claude"
        assert data["backend"]["model"] == "claude-test"
        assert data["answer"] == "Claude response"


class TestHelp:
    def test_main_help(self, runner):
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "tg" in result.output
        assert "session-build" in result.output
        assert "ask" in result.output
