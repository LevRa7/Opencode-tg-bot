"""Tests for MessageDB — uses temp SQLite, no Telegram dependency."""

import sqlite3

from conftest import make_msg
from tg_cli.session_engine import DialogSessionEngine


class TestEventSourcedStorage:
    def test_event_tables_exist(self, db):
        table_names = {
            row[0]
            for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        assert "message_events" in table_names
        assert "message_versions" in table_names
        assert "message_reads" in table_names
        assert "message_reactions" in table_names
        assert "sync_state" in table_names

    def test_insert_message_version_and_event(self, db):
        db.insert_message(**make_msg(msg_id=1, content="hello"))
        db.insert_message_version(
            chat_id=100,
            msg_id=1,
            version_no=1,
            content="hello",
            observed_at="2026-04-04T00:00:00+00:00",
            edit_date=None,
            raw_json={"text": "hello"},
        )
        db.insert_message_event(
            chat_id=100,
            msg_id=1,
            event_type="created",
            event_ts="2026-04-04T00:00:00+00:00",
            payload_json={"source": "test"},
        )
        versions = db.list_message_versions(100, 1)
        events = db.list_message_events(100, 1)
        assert versions[0]["version_no"] == 1
        assert events[0]["event_type"] == "created"
        assert events[0]["payload_json"]["source"] == "test"

    def test_mark_message_deleted_preserves_message_row(self, db):
        db.insert_message(**make_msg(msg_id=1, content="bye"))
        db.mark_message_deleted(100, 1, deleted_at="2026-04-04T00:00:00+00:00")
        row = db.get_message(100, 1)
        assert row["is_deleted"] == 1
        assert row["content"] == "bye"

    def test_record_message_read_updates_reads_table_and_message(self, db):
        db.insert_message(**make_msg(msg_id=1, content="hello"))
        db.record_message_read(
            chat_id=100,
            msg_id=1,
            direction="outgoing",
            first_observed_read_at="2026-04-04T00:00:00+00:00",
            source="listener",
            confidence=0.8,
        )
        reads = db.list_message_reads(100, 1)
        row = db.get_message(100, 1)
        assert reads[0]["direction"] == "outgoing"
        assert row["read_state"] == "read_observed"

    def test_replace_message_reactions_updates_summary(self, db):
        db.insert_message(**make_msg(msg_id=1, content="hello"))
        db.replace_message_reactions(
            chat_id=100,
            msg_id=1,
            reactions=[{"reaction": "👍", "actor_id": "user1"}, {"reaction": "🔥", "actor_id": "user2"}],
            observed_at="2026-04-04T00:00:00+00:00",
        )
        row = db.get_message(100, 1)
        reactions = db.list_message_reactions(100, 1)
        assert row["reaction_count"] == 2
        assert "👍" in (row["emoji_summary"] or "")
        assert len(reactions) == 2

    def test_upsert_sync_state_roundtrip(self, db):
        db.upsert_sync_state(100, last_msg_id=42, last_full_scan_at="2026-04-04T00:00:00+00:00")
        state = db.get_sync_state(100)
        assert state["last_msg_id"] == 42


class TestSubjectStorage:
    def test_subject_tables_exist(self, db):
        table_names = {
            row[0]
            for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        assert "subjects" in table_names
        assert "subject_aliases" in table_names
        assert "subject_observations" in table_names

    def test_upsert_subject_and_alias(self, db):
        db.upsert_subject(
            subject_id="telegram:user:731038050",
            external_id="731038050",
            display_name="Снежана",
            first_seen_at="2026-01-01T00:00:00+00:00",
            last_seen_at="2026-01-02T00:00:00+00:00",
        )
        db.insert_subject_alias(
            subject_id="telegram:user:731038050",
            alias_type="display_name",
            alias_value="Снежана",
            first_seen_at="2026-01-01T00:00:00+00:00",
            last_seen_at="2026-01-02T00:00:00+00:00",
            source_msg_id=10,
        )
        subject = db.get_subject("telegram:user:731038050")
        aliases = db.list_subject_aliases("telegram:user:731038050")
        assert subject["display_name"] == "Снежана"
        assert aliases[0]["alias_value"] == "Снежана"

    def test_insert_subject_observation(self, db):
        db.insert_subject_observation(
            subject_id="telegram:user:731038050",
            chat_id=100,
            field="work",
            value="цветочном магазине",
            explicitly_stated=True,
            confidence=1.0,
            observed_at="2026-04-04T00:00:00+00:00",
            source_msg_id=10,
        )
        observations = db.list_subject_observations(subject_id="telegram:user:731038050")
        assert observations[0]["field"] == "work"
        assert observations[0]["value"] == "цветочном магазине"


class TestAssertionStorage:
    def test_assertion_tables_exist(self, db):
        table_names = {
            row[0]
            for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        assert "subject_assertions" in table_names
        assert "assertion_evidence" in table_names

    def test_upsert_and_resolve_active_assertion(self, db):
        db.upsert_subject_assertion(
            assertion_id="a1",
            subject_id="telegram:user:731038050",
            chat_id=100,
            field="work",
            value="цветочный магазин",
            status="active",
            confidence=1.0,
            valid_from_ts="2026-01-01T00:00:00+00:00",
            valid_to_ts=None,
            first_seen_at="2026-01-01T00:00:00+00:00",
            last_seen_at="2026-01-01T00:00:00+00:00",
            supersedes_assertion_id=None,
            source_type="explicit_statement",
        )
        active = db.get_active_assertions("telegram:user:731038050", field="work")
        assert active[0]["value"] == "цветочный магазин"

    def test_assertion_as_of(self, db):
        db.upsert_subject_assertion(
            assertion_id="a1",
            subject_id="telegram:user:731038050",
            chat_id=100,
            field="work",
            value="старое место",
            status="superseded",
            confidence=1.0,
            valid_from_ts="2026-01-01T00:00:00+00:00",
            valid_to_ts="2026-02-01T00:00:00+00:00",
            first_seen_at="2026-01-01T00:00:00+00:00",
            last_seen_at="2026-02-01T00:00:00+00:00",
            supersedes_assertion_id=None,
            source_type="explicit_statement",
        )
        historical = db.get_assertions_as_of(
            "telegram:user:731038050",
            "work",
            "2026-01-15T00:00:00+00:00",
        )
        assert historical[0]["value"] == "старое место"

    def test_assertion_evidence_roundtrip(self, db):
        db.upsert_subject_assertion(
            assertion_id="a1",
            subject_id="telegram:user:731038050",
            chat_id=100,
            field="work",
            value="цветочный магазин",
            status="active",
            confidence=1.0,
            valid_from_ts="2026-01-01T00:00:00+00:00",
            valid_to_ts=None,
            first_seen_at="2026-01-01T00:00:00+00:00",
            last_seen_at="2026-01-01T00:00:00+00:00",
            supersedes_assertion_id=None,
            source_type="explicit_statement",
        )
        db.link_assertion_evidence(
            assertion_id="a1",
            source_msg_id=10,
            evidence_type="direct",
            observed_at="2026-01-01T00:00:00+00:00",
        )
        evidence = db.list_assertion_evidence("a1")
        assert evidence[0]["source_msg_id"] == 10


class TestInsertMessage:
    def test_insert_and_count(self, db):
        ok = db.insert_message(**make_msg())
        assert ok is True
        assert db.count() == 1

    def test_duplicate_ignored(self, db):
        db.insert_message(**make_msg(msg_id=1))
        ok = db.insert_message(**make_msg(msg_id=1))
        assert ok is False
        assert db.count() == 1

    def test_different_msg_ids(self, db):
        db.insert_message(**make_msg(msg_id=1))
        db.insert_message(**make_msg(msg_id=2))
        assert db.count() == 2

    def test_insert_message_persists_enriched_fields(self, db):
        db.insert_message(
            **make_msg(msg_id=1),
            reply_to_msg_id=42,
            message_kind="photo",
            has_media=True,
            raw_json={"foo": "bar"},
        )
        row = db.get_chat_messages(100)[0]
        assert row["reply_to_msg_id"] == 42
        assert row["message_kind"] == "photo"
        assert row["has_media"] == 1
        assert row["raw_json"] is not None


class TestInsertBatch:
    def test_batch_insert(self, db):
        msgs = [make_msg(msg_id=i) for i in range(50)]
        result = db.insert_batch(msgs)
        assert result == 50
        assert db.count() == 50

    def test_batch_empty(self, db):
        result = db.insert_batch([])
        assert result == 0

    def test_batch_with_duplicates(self, db):
        db.insert_message(**make_msg(msg_id=1))
        msgs = [make_msg(msg_id=i) for i in range(1, 6)]
        inserted = db.insert_batch(msgs)
        assert inserted == 4
        assert db.count() == 5


class TestSearch:
    def test_search_found(self, db):
        db.insert_message(**make_msg(content="Rust is great"))
        db.insert_message(**make_msg(msg_id=2, content="Python is good"))
        results = db.search("Rust")
        assert len(results) == 1
        assert "Rust" in results[0]["content"]

    def test_search_not_found(self, db):
        db.insert_message(**make_msg(content="Hello"))
        results = db.search("Golang")
        assert len(results) == 0

    def test_search_case_insensitive(self, db):
        db.insert_message(**make_msg(content="Hello World"))
        results = db.search("hello")
        assert len(results) == 1

    def test_search_with_chat_filter(self, db):
        db.insert_message(**make_msg(chat_id=100, content="Web3 job"))
        db.insert_message(**make_msg(chat_id=200, msg_id=2, content="Web3 course"))
        results = db.search("Web3", chat_id=100)
        assert len(results) == 1

    def test_search_with_sender_filter(self, db):
        db.insert_message(**make_msg(msg_id=1, sender_name="Alice", content="Rust job"))
        db.insert_message(**make_msg(msg_id=2, sender_name="Bob", content="Rust course"))
        results = db.search("Rust", sender="Ali")
        assert len(results) == 1
        assert results[0]["sender_name"] == "Alice"

    def test_search_with_hours_filter(self, db):
        db.insert_message(**make_msg(msg_id=1, content="Rust today", hours_ago=1))
        db.insert_message(**make_msg(msg_id=2, content="Rust old", hours_ago=72))
        results = db.search("Rust", hours=24)
        assert len(results) == 1
        assert results[0]["content"] == "Rust today"

    def test_search_limit(self, db):
        for i in range(20):
            db.insert_message(**make_msg(msg_id=i, content=f"test msg {i}"))
        results = db.search("test", limit=5)
        assert len(results) == 5

    def test_search_regex_found(self, db):
        db.insert_message(**make_msg(msg_id=1, content="Rust and Go"))
        db.insert_message(**make_msg(msg_id=2, content="Python only"))
        results = db.search_regex(r"Rust.*Go")
        assert len(results) == 1
        assert results[0]["content"] == "Rust and Go"

    def test_search_regex_with_sender_filter(self, db):
        db.insert_message(**make_msg(msg_id=1, sender_name="Alice", content="Rust remote"))
        db.insert_message(**make_msg(msg_id=2, sender_name="Bob", content="Rust remote"))
        results = db.search_regex(r"rust\s+remote", sender="Ali")
        assert len(results) == 1
        assert results[0]["sender_name"] == "Alice"


class TestGetRecent:
    def test_recent_within_hours(self, db):
        db.insert_message(**make_msg(msg_id=1, hours_ago=1))
        db.insert_message(**make_msg(msg_id=2, hours_ago=48))
        results = db.get_recent(hours=24)
        assert len(results) == 1

    def test_recent_all(self, db):
        db.insert_message(**make_msg(msg_id=1, hours_ago=1))
        db.insert_message(**make_msg(msg_id=2, hours_ago=720))
        results = db.get_recent(hours=None, limit=100)
        assert len(results) == 2

    def test_recent_with_chat_filter(self, db):
        db.insert_message(**make_msg(chat_id=100, msg_id=1))
        db.insert_message(**make_msg(chat_id=200, msg_id=2))
        results = db.get_recent(chat_id=100, hours=24)
        assert len(results) == 1

    def test_recent_with_sender_filter(self, db):
        db.insert_message(**make_msg(msg_id=1, sender_name="Alice"))
        db.insert_message(**make_msg(msg_id=2, sender_name="Bob"))
        results = db.get_recent(sender="Ali", hours=24)
        assert len(results) == 1
        assert results[0]["sender_name"] == "Alice"

    def test_recent_limit_returns_latest_messages(self, db):
        for i in range(5):
            db.insert_message(**make_msg(msg_id=10 + i, content=f"msg {i}", hours_ago=5 - i))
        results = db.get_recent(hours=24, limit=2)
        assert [r["content"] for r in results] == ["msg 3", "msg 4"]


class TestGetChats:
    def test_chats_summary(self, db):
        for i in range(5):
            db.insert_message(**make_msg(chat_id=100, chat_name="GroupA", msg_id=i))
        for i in range(3):
            db.insert_message(**make_msg(chat_id=200, chat_name="GroupB", msg_id=100 + i))

        chats = db.get_chats()
        assert len(chats) == 2
        assert chats[0]["chat_name"] == "GroupA"
        assert chats[0]["msg_count"] == 5
        assert chats[1]["chat_name"] == "GroupB"
        assert chats[1]["msg_count"] == 3


class TestGetLastMsgId:
    def test_returns_max_id(self, db):
        for i in [10, 20, 15]:
            db.insert_message(**make_msg(msg_id=i))
        assert db.get_last_msg_id(100) == 20

    def test_returns_none_for_empty(self, db):
        assert db.get_last_msg_id(999) is None


class TestGetLatestTimestamp:
    def test_latest_timestamp(self, db):
        db.insert_message(**make_msg(msg_id=1, hours_ago=3))
        db.insert_message(**make_msg(msg_id=2, hours_ago=1))
        latest = db.get_latest_timestamp()
        assert latest is not None
        assert latest.endswith("+00:00")

    def test_latest_timestamp_empty(self, db):
        assert db.get_latest_timestamp() is None


class TestResolveChatId:
    def test_resolve_by_name(self, db):
        db.insert_message(**make_msg(chat_id=100, chat_name="MyGroup"))
        assert db.resolve_chat_id("MyGroup") == 100

    def test_resolve_by_partial_name(self, db):
        db.insert_message(**make_msg(chat_id=100, chat_name="DeJob—Web3招聘"))
        assert db.resolve_chat_id("DeJob") == 100

    def test_resolve_by_numeric_id(self, db):
        db.insert_message(**make_msg(chat_id=1570628112))
        assert db.resolve_chat_id("-1001570628112") == 1570628112

    def test_resolve_unknown(self, db):
        result = db.resolve_chat_id("nonexistent")
        assert result is None

    def test_resolve_ambiguous_returns_none(self, db):
        db.insert_message(**make_msg(chat_id=100, chat_name="Dev Group"))
        db.insert_message(**make_msg(chat_id=200, chat_name="Dev Chat", msg_id=2))
        assert db.resolve_chat_id("Dev") is None

    def test_find_chats_returns_all_partial_matches(self, db):
        db.insert_message(**make_msg(chat_id=100, chat_name="Dev Group"))
        db.insert_message(**make_msg(chat_id=200, chat_name="Dev Chat", msg_id=2))
        matches = db.find_chats("Dev")
        assert len(matches) == 2


class TestDeleteChat:
    def test_delete(self, db):
        for i in range(5):
            db.insert_message(**make_msg(chat_id=100, msg_id=i))
        db.insert_message(**make_msg(chat_id=200, msg_id=99))

        deleted = db.delete_chat(100)
        assert deleted == 5
        assert db.count() == 1

    def test_delete_nonexistent(self, db):
        deleted = db.delete_chat(999)
        assert deleted == 0


class TestContextManager:
    def test_context_manager(self, tmp_path):
        from tg_cli.db import MessageDB

        db_path = tmp_path / "ctx.db"
        with MessageDB(db_path=db_path) as d:
            d.insert_message(**make_msg())
            assert d.count() == 1


class TestTopSenders:
    def test_top_senders(self, db):
        for i in range(5):
            db.insert_message(**make_msg(msg_id=i, sender_id=101, sender_name="Alice"))
        for i in range(3):
            db.insert_message(**make_msg(msg_id=10 + i, sender_id=202, sender_name="Bob"))

        results = db.top_senders()
        assert len(results) == 2
        assert results[0]["sender_name"] == "Alice"
        assert results[0]["msg_count"] == 5

    def test_top_senders_with_chat_filter(self, db):
        db.insert_message(**make_msg(chat_id=100, msg_id=1, sender_id=101, sender_name="Alice"))
        db.insert_message(**make_msg(chat_id=200, msg_id=2, sender_id=202, sender_name="Bob"))
        results = db.top_senders(chat_id=100)
        assert len(results) == 1

    def test_top_senders_with_hours(self, db):
        db.insert_message(**make_msg(msg_id=1, sender_id=101, sender_name="Alice", hours_ago=1))
        db.insert_message(**make_msg(msg_id=2, sender_id=202, sender_name="Bob", hours_ago=48))
        results = db.top_senders(hours=24)
        assert len(results) == 1

    def test_top_senders_limit(self, db):
        for i in range(10):
            db.insert_message(**make_msg(msg_id=i, sender_id=100 + i, sender_name=f"User{i}"))
        results = db.top_senders(limit=3)
        assert len(results) == 3

    def test_top_senders_keeps_same_name_different_ids_separate(self, db):
        db.insert_message(**make_msg(msg_id=1, sender_id=101, sender_name="Alex"))
        db.insert_message(**make_msg(msg_id=2, sender_id=202, sender_name="Alex"))
        results = db.top_senders(limit=10)
        assert len(results) == 2


class TestTimeline:
    def test_timeline_by_day(self, db):
        db.insert_message(**make_msg(msg_id=1, hours_ago=0))
        db.insert_message(**make_msg(msg_id=2, hours_ago=1))
        db.insert_message(**make_msg(msg_id=3, hours_ago=25))

        results = db.timeline(granularity="day")
        assert len(results) >= 1
        for r in results:
            assert "period" in r
            assert "msg_count" in r

    def test_timeline_by_hour(self, db):
        db.insert_message(**make_msg(msg_id=1, hours_ago=0))
        db.insert_message(**make_msg(msg_id=2, hours_ago=2))
        results = db.timeline(granularity="hour")
        assert len(results) >= 1

    def test_timeline_with_chat_filter(self, db):
        db.insert_message(**make_msg(chat_id=100, msg_id=1))
        db.insert_message(**make_msg(chat_id=200, msg_id=2))
        results = db.timeline(chat_id=100)
        total = sum(r["msg_count"] for r in results)
        assert total == 1

    def test_timeline_empty(self, db):
        results = db.timeline()
        assert results == []


class TestGetToday:
    def test_today_returns_recent(self, db):
        db.insert_message(**make_msg(msg_id=1, hours_ago=1))
        db.insert_message(**make_msg(msg_id=2, hours_ago=48))
        results = db.get_today()
        assert len(results) == 1

    def test_today_with_chat_filter(self, db):
        db.insert_message(**make_msg(chat_id=100, msg_id=1, hours_ago=1))
        db.insert_message(**make_msg(chat_id=200, msg_id=2, hours_ago=1))
        results = db.get_today(chat_id=100)
        assert len(results) == 1


class TestMigrationsAndSessionTables:
    def test_migrates_legacy_messages_table(self, tmp_path):
        db_path = tmp_path / "legacy.db"
        conn = sqlite3.connect(db_path)
        conn.execute(
            """CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL DEFAULT 'telegram',
                chat_id INTEGER NOT NULL,
                chat_name TEXT,
                msg_id INTEGER NOT NULL,
                sender_id INTEGER,
                sender_name TEXT,
                content TEXT,
                timestamp TEXT NOT NULL,
                raw_json TEXT,
                UNIQUE(platform, chat_id, msg_id)
            )"""
        )
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
        conn.close()

        from tg_cli.db import MessageDB

        db = MessageDB(db_path=db_path)
        row = db.conn.execute("PRAGMA table_info(messages)").fetchall()
        columns = {item[1] for item in row}
        assert "reply_to_msg_id" in columns
        assert "message_kind" in columns
        assert "has_media" in columns
        assert db.conn.execute("PRAGMA user_version").fetchone()[0] >= 3
        session_tables = {
            item[0]
            for item in db.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "dialog_sessions" in session_tables
        assert "dialog_segments" in session_tables
        db.close()

    def test_session_state_roundtrip(self, db):
        session = {
            "session_id": "telegram:100",
            "chat_id": 100,
            "chat_name": "TestChat",
            "dialog_type": "chat",
            "first_msg_ts": "2026-04-01T00:00:00+00:00",
            "last_msg_ts": "2026-04-02T00:00:00+00:00",
            "message_count": 10,
            "segment_count": 2,
            "last_raw_msg_id": 42,
            "last_built_at": "2026-04-04T00:00:00+00:00",
        }
        db.upsert_dialog_session(session)
        db.replace_dialog_segments(
            100,
            [
                {
                    "segment_id": "seg-1",
                    "session_id": "telegram:100",
                    "seq": 1,
                    "start_msg_id": 1,
                    "end_msg_id": 5,
                    "start_ts": "2026-04-01T00:00:00+00:00",
                    "end_ts": "2026-04-01T01:00:00+00:00",
                    "message_count": 5,
                    "dominant_sender": "Alice",
                    "topic_hint": "chat",
                    "summary": "segment summary",
                }
            ],
        )
        db.replace_dialog_summaries(
            100,
            [
                {
                    "summary_id": "sum-1",
                    "session_id": "telegram:100",
                    "segment_id": "seg-1",
                    "kind": "segment",
                    "summary": "segment summary",
                    "payload_json": {"foo": "bar"},
                    "created_at": "2026-04-04T00:00:00+00:00",
                }
            ],
        )
        db.replace_dialog_facts(
            100,
            [
                {
                    "fact_id": "fact-1",
                    "session_id": "telegram:100",
                    "fact_type": "activity",
                    "subject": "TestChat",
                    "predicate": "top_sender",
                    "object": "Alice",
                    "value_json": {"message_count": 3},
                    "confidence": 0.9,
                    "created_at": "2026-04-04T00:00:00+00:00",
                }
            ],
        )
        db.replace_dialog_evidence(
            100,
            [
                {
                    "session_id": "telegram:100",
                    "owner_type": "fact",
                    "owner_id": "fact-1",
                    "msg_id": 3,
                    "note": "evidence",
                }
            ],
        )
        db.insert_dialog_compaction(
            {
                "compaction_id": "comp-1",
                "session_id": "telegram:100",
                "chat_id": 100,
                "summary_id": "sum-1",
                "covered_until_msg_id": 5,
                "preserved_tail_count": 1,
                "policy_json": {"policy": "test"},
                "created_at": "2026-04-04T00:00:00+00:00",
            }
        )

        assert db.get_dialog_session(100)["session_id"] == "telegram:100"
        assert db.get_dialog_segments(100)[0]["segment_id"] == "seg-1"
        assert db.get_dialog_summaries(100)[0]["payload_json"]["foo"] == "bar"
        assert db.get_dialog_facts(100)[0]["object"] == "Alice"
        assert db.get_dialog_evidence(100)[0]["msg_id"] == 3
        assert db.get_dialog_compactions(100)[0]["policy_json"]["policy"] == "test"

        db.reset_dialog_session_state(100)
        assert db.get_dialog_session(100) is None
        assert db.get_dialog_segments(100) == []
        assert db.get_dialog_summaries(100) == []
        assert db.get_dialog_facts(100) == []

    def test_session_engine_extracts_keywords_and_open_loops(self, db):
        db.insert_message(**make_msg(msg_id=1, content="Нужно проверить бюджет проекта и созвониться завтра"))
        db.insert_message(**make_msg(msg_id=2, content="Скину ссылку позже https://example.com/doc"))
        db.insert_message(**make_msg(msg_id=3, content="Фото отчета", has_media=True, message_kind="photo"))
        result = DialogSessionEngine(db).build_for_chat(100)
        assert result.fact_count >= 3
        facts = db.get_dialog_facts(100)
        predicates = {fact["predicate"] for fact in facts}
        assert "top_keywords" in predicates
        assert "has_follow_up_candidates" in predicates
        assert "shares_links" in predicates
