"""Tests for event-sourced message observation helpers."""

from __future__ import annotations

from conftest import make_msg
from tg_cli.message_observer import build_message_state, observe_message_create, observe_message_delete, observe_message_read, observe_message_reactions, observe_message_update


def test_build_message_state_sets_observation_fields():
    state = build_message_state(
        chat_id=100,
        chat_name="TestChat",
        msg_id=1,
        sender_id=42,
        sender_name="Alice",
        content="hello",
        timestamp="2026-04-04T00:00:00+00:00",
        reply_to_msg_id=None,
        message_kind="message",
        has_media=False,
        raw_json={"forward": {"from_name": "Bob"}},
    )
    assert state["first_observed_at"]
    assert state["last_observed_at"]
    assert state["is_forwarded"] is True
    assert state["forwarded_from_name"] == "Bob"


def test_observe_message_create_creates_message_version_and_event(db):
    state = build_message_state(
        chat_id=100,
        chat_name="TestChat",
        msg_id=1,
        sender_id=42,
        sender_name="Alice",
        content="hello",
        timestamp="2026-04-04T00:00:00+00:00",
        reply_to_msg_id=None,
        message_kind="message",
        has_media=False,
        raw_json={"text": "hello"},
    )
    created = observe_message_create(db, state)
    assert created is True
    assert db.get_message(100, 1)["content"] == "hello"
    assert db.list_message_versions(100, 1)[0]["version_no"] == 1
    assert db.list_message_events(100, 1)[0]["event_type"] == "created"


def test_observe_message_update_creates_new_version_on_content_change(db):
    state = build_message_state(
        chat_id=100,
        chat_name="TestChat",
        msg_id=1,
        sender_id=42,
        sender_name="Alice",
        content="hello",
        timestamp="2026-04-04T00:00:00+00:00",
        reply_to_msg_id=None,
        message_kind="message",
        has_media=False,
        raw_json={"text": "hello"},
    )
    observe_message_create(db, state)
    updated = dict(state)
    updated["content"] = "hello edited"
    updated["last_observed_at"] = "2026-04-04T00:05:00+00:00"
    result = observe_message_update(db, updated)
    versions = db.list_message_versions(100, 1)
    events = db.list_message_events(100, 1)
    assert result == "edited"
    assert len(versions) == 2
    assert events[-1]["event_type"] == "edited"


def test_observe_message_delete_records_delete_event(db):
    db.insert_message(**make_msg(msg_id=1, content="bye"))
    observe_message_delete(db, chat_id=100, msg_id=1)
    row = db.get_message(100, 1)
    events = db.list_message_events(100, 1)
    assert row["is_deleted"] == 1
    assert events[-1]["event_type"] == "deleted"


def test_observe_message_read_records_event_and_read_state(db):
    db.insert_message(**make_msg(msg_id=1, content="hello"))
    observe_message_read(db, chat_id=100, msg_id=1, direction="outgoing", source="listener")
    reads = db.list_message_reads(100, 1)
    events = db.list_message_events(100, 1)
    assert reads
    assert events[-1]["event_type"] == "read_observed"


def test_observe_message_reactions_records_event_and_reaction_rows(db):
    db.insert_message(**make_msg(msg_id=1, content="hello"))
    observe_message_reactions(
        db,
        chat_id=100,
        msg_id=1,
        reactions=[{"reaction": "👍", "actor_id": "user1"}],
    )
    reactions = db.list_message_reactions(100, 1)
    events = db.list_message_events(100, 1)
    assert reactions[0]["reaction"] == "👍"
    assert events[-1]["event_type"] == "reaction_changed"
