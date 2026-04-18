"""Tests for temporal assertion resolver."""

from __future__ import annotations

from tg_cli.assertion_resolver import apply_observation, resolve_field_as_of, resolve_field_current


def test_apply_observation_creates_active_assertion(db):
    assertion_id = apply_observation(
        db,
        subject_id="telegram:user:731038050",
        chat_id=100,
        observation={
            "field": "work",
            "value": "цветочный магазин",
            "confidence": 1.0,
            "observed_at": "2026-01-01T00:00:00+00:00",
            "source_msg_id": 10,
        },
    )
    current = resolve_field_current(db, "telegram:user:731038050", "work")
    assert current is not None
    assert current["assertion_id"] == assertion_id
    assert current["value"] == "цветочный магазин"


def test_apply_observation_supersedes_old_dynamic_assertion(db):
    first = apply_observation(
        db,
        subject_id="telegram:user:731038050",
        chat_id=100,
        observation={
            "field": "work",
            "value": "цветочный магазин",
            "confidence": 1.0,
            "observed_at": "2026-01-01T00:00:00+00:00",
            "source_msg_id": 10,
        },
    )
    second = apply_observation(
        db,
        subject_id="telegram:user:731038050",
        chat_id=100,
        observation={
            "field": "work",
            "value": "бариста",
            "confidence": 1.0,
            "observed_at": "2026-02-01T00:00:00+00:00",
            "source_msg_id": 11,
        },
    )
    current = resolve_field_current(db, "telegram:user:731038050", "work")
    historical = resolve_field_as_of(db, "telegram:user:731038050", "work", "2026-01-15T00:00:00+00:00")
    first_evidence = db.list_assertion_evidence(first)
    second_evidence = db.list_assertion_evidence(second)
    assert current is not None
    assert current["value"] == "бариста"
    assert historical is not None
    assert historical["value"] == "цветочный магазин"
    assert first_evidence[0]["source_msg_id"] == 10
    assert second_evidence[0]["source_msg_id"] == 11


def test_same_value_updates_existing_assertion_instead_of_creating_new_one(db):
    first = apply_observation(
        db,
        subject_id="telegram:user:731038050",
        chat_id=100,
        observation={
            "field": "city",
            "value": "Петербург",
            "confidence": 1.0,
            "observed_at": "2026-01-01T00:00:00+00:00",
            "source_msg_id": 10,
        },
    )
    second = apply_observation(
        db,
        subject_id="telegram:user:731038050",
        chat_id=100,
        observation={
            "field": "city",
            "value": "Петербург",
            "confidence": 1.0,
            "observed_at": "2026-01-10T00:00:00+00:00",
            "source_msg_id": 11,
        },
    )
    current = resolve_field_current(db, "telegram:user:731038050", "city")
    evidence = db.list_assertion_evidence(first)
    assert first == second
    assert current["assertion_id"] == first
    assert len(evidence) == 2
