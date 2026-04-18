"""TDD tests for richer relation analysis: topic timeline, initiative balance, support roles."""

from __future__ import annotations

from tg_cli.interaction_analyzer import analyze_interaction_metrics, analyze_interaction_patterns, build_topic_timeline


def _msg(msg_id: int, sender_name: str, content: str, ts: str) -> dict:
    return {
        "chat_id": 731038050,
        "msg_id": msg_id,
        "sender_name": sender_name,
        "content": content,
        "timestamp": ts,
        "message_kind": "message",
        "has_media": False,
    }


def test_build_topic_timeline_detects_feedback_support_and_care_topics():
    messages = [
        _msg(1, "Снежана", "Чуть без души", "2026-01-26T19:28:37+00:00"),
        _msg(2, "Снежана", "А так круто", "2026-01-26T19:28:43+00:00"),
        _msg(3, "Лев", "/login", "2026-01-26T20:44:36+00:00"),
        _msg(4, "Лев", "отправь боту", "2026-01-26T20:44:39+00:00"),
        _msg(5, "Снежана", "Стрем", "2026-01-26T22:45:14+00:00"),
    ]
    timeline = build_topic_timeline(messages)
    labels = {item["topic_label"] for item in timeline}
    assert "feedback" in labels or "support" in labels or "care" in labels


def test_interaction_metrics_include_initiative_balance():
    messages = [
        _msg(1, "Снежана", "Привет", "2026-01-26T10:00:00+00:00"),
        _msg(2, "Лев", "Привет", "2026-01-26T10:05:00+00:00"),
        _msg(3, "Лев", "Еще мысль", "2026-01-26T10:06:00+00:00"),
        _msg(4, "Снежана", "Ог", "2026-01-26T10:10:00+00:00"),
    ]
    metrics = analyze_interaction_metrics(messages, subject_id="telegram:user:731038050")
    assert "initiative_balance" in metrics


def test_patterns_detect_support_role_modelling():
    messages = [
        _msg(1, "Лев", "Токен помер", "2026-01-26T20:44:27+00:00"),
        _msg(2, "Лев", "/login", "2026-01-26T20:44:36+00:00"),
        _msg(3, "Лев", "отправь боту", "2026-01-26T20:44:39+00:00"),
        _msg(4, "Снежана", "Я возможно вышла из бота", "2026-01-27T15:03:14+00:00"),
    ]
    patterns = analyze_interaction_patterns(messages, subject_id="telegram:user:731038050")
    assert any(item["pattern_type"] == "support_role_lead" for item in patterns)
