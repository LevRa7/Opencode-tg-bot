"""TDD tests for richer interaction patterns v2."""

from __future__ import annotations

from tg_cli.interaction_analyzer import analyze_interaction_patterns


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


def test_detects_nuanced_feedback_pattern():
    messages = [
        _msg(1, "Снежана", "Чуть без души", "2026-01-26T19:28:37+00:00"),
        _msg(2, "Снежана", "А так круто", "2026-01-26T19:28:43+00:00"),
    ]
    patterns = analyze_interaction_patterns(messages, subject_id="telegram:user:731038050")
    assert any(item["pattern_type"] == "nuanced_feedback" for item in patterns)


def test_detects_support_coordination_pattern():
    messages = [
        _msg(1, "Лев", "Он на токен авторизации жалуется", "2026-01-26T20:44:27+00:00"),
        _msg(2, "Лев", "/login", "2026-01-26T20:44:36+00:00"),
        _msg(3, "Лев", "отправь боту", "2026-01-26T20:44:39+00:00"),
    ]
    patterns = analyze_interaction_patterns(messages, subject_id="telegram:user:731038050")
    assert any(item["pattern_type"] == "support_coordination" for item in patterns)


def test_detects_care_escalation_pattern():
    messages = [
        _msg(1, "Лев", "В груди болит", "2026-01-26T22:40:31+00:00"),
        _msg(2, "Снежана", "Стрем", "2026-01-26T22:45:14+00:00"),
        _msg(3, "Снежана", "У ии спросил?", "2026-01-26T22:45:25+00:00"),
        _msg(4, "Снежана", "Что с тобой и почему", "2026-01-26T22:45:30+00:00"),
    ]
    patterns = analyze_interaction_patterns(messages, subject_id="telegram:user:731038050")
    assert any(item["pattern_type"] == "care_escalation" for item in patterns)


def test_detects_follow_up_reliability_signal_from_future_commitment():
    messages = [
        _msg(1, "Снежана", "Почтой напишу", "2026-01-26T19:28:12+00:00"),
        _msg(2, "Снежана", "Ну", "2026-01-26T19:28:33+00:00"),
    ]
    patterns = analyze_interaction_patterns(messages, subject_id="telegram:user:731038050")
    assert any(item["pattern_type"] == "follow_up_commitment" for item in patterns)
