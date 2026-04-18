"""TDD tests for interaction analytics."""

from __future__ import annotations

from datetime import datetime, timezone

from tg_cli.interaction_analyzer import analyze_interaction_metrics, analyze_interaction_patterns


def _msg(msg_id: int, sender_name: str, content: str, ts: str) -> dict:
    return {
        "chat_id": 100,
        "msg_id": msg_id,
        "sender_name": sender_name,
        "content": content,
        "timestamp": ts,
        "message_kind": "message",
        "has_media": False,
    }


def test_analyze_interaction_metrics_computes_response_latency():
    messages = [
        _msg(1, "Снежана", "Привет", "2026-01-01T10:00:00+00:00"),
        _msg(2, "Лев", "Привет!", "2026-01-01T10:05:00+00:00"),
        _msg(3, "Снежана", "Как ты?", "2026-01-01T10:10:00+00:00"),
    ]
    metrics = analyze_interaction_metrics(messages, subject_id="telegram:user:731038050")
    assert metrics["sent_count"] >= 1
    assert metrics["avg_response_latency_sec"] is not None


def test_analyze_interaction_patterns_detects_caring_response():
    messages = [
        _msg(1, "Лев", "Мне плохо и в груди болит", "2026-01-01T10:00:00+00:00"),
        _msg(2, "Снежана", "Стрем", "2026-01-01T10:02:00+00:00"),
        _msg(3, "Снежана", "Что с тобой и почему", "2026-01-01T10:03:00+00:00"),
    ]
    patterns = analyze_interaction_patterns(messages, subject_id="telegram:user:731038050")
    assert any(item["pattern_type"] == "caring_response" for item in patterns)


def test_analyze_interaction_patterns_detects_short_ack_style():
    messages = [
        _msg(1, "Лев", "Очень длинное объяснение про систему", "2026-01-01T10:00:00+00:00"),
        _msg(2, "Снежана", "Ог", "2026-01-01T10:01:00+00:00"),
        _msg(3, "Снежана", "Вижу", "2026-01-01T10:02:00+00:00"),
    ]
    patterns = analyze_interaction_patterns(messages, subject_id="telegram:user:731038050")
    assert any(item["pattern_type"] == "short_ack" for item in patterns)


def test_analyze_interaction_metrics_counts_emojis():
    messages = [
        _msg(1, "Снежана", "Привет 🙂", "2026-01-01T10:00:00+00:00"),
        _msg(2, "Снежана", "Круто 🔥", "2026-01-01T10:02:00+00:00"),
    ]
    metrics = analyze_interaction_metrics(messages, subject_id="telegram:user:731038050")
    assert metrics["emoji_count"] >= 2
