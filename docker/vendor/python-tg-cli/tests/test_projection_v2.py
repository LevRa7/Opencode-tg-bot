"""Tests for session projection v2 with assertions and intent-aware memory routing."""

from __future__ import annotations

from tg_cli.assertion_resolver import apply_observation
from tg_cli.session_engine import DialogSessionEngine
from conftest import make_msg


def test_projection_includes_active_assertions_for_current_question(db):
    db.insert_message(**make_msg(msg_id=1, content="Базовое сообщение"))
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
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    projection = engine.build_ask_projection(100, "Где она работает сейчас?")
    assert "active_assertions" in projection
    assert projection["active_assertions"]
    assert projection["active_assertions"][0]["value"] == "бариста"


def test_projection_can_include_historical_assertions_for_past_question(db):
    db.insert_message(**make_msg(msg_id=1, content="Базовое сообщение"))
    apply_observation(
        db,
        subject_id="telegram:user:100",
        chat_id=100,
        observation={
            "field": "work",
            "value": "цветочный магазин",
            "confidence": 1.0,
            "observed_at": "2026-01-01T00:00:00+00:00",
            "source_msg_id": 10,
        },
    )
    apply_observation(
        db,
        subject_id="telegram:user:100",
        chat_id=100,
        observation={
            "field": "work",
            "value": "бариста",
            "confidence": 1.0,
            "observed_at": "2026-02-01T00:00:00+00:00",
            "source_msg_id": 11,
        },
    )
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    projection = engine.build_ask_projection(100, "Где она работала раньше?")
    assert "historical_assertions" in projection
    assert any(item["value"] == "цветочный магазин" for item in projection["historical_assertions"])


def test_projection_keeps_interaction_patterns_alongside_assertions(db):
    db.insert_message(**make_msg(msg_id=1, sender_name="Лев", content="Мне плохо", hours_ago=2))
    db.insert_message(**make_msg(msg_id=2, sender_name="Снежана", content="Стрем", hours_ago=1.9))
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    projection = engine.build_ask_projection(100, "Какой у нас стиль общения?")
    assert "interaction_patterns" in projection
    assert "active_assertions" in projection
