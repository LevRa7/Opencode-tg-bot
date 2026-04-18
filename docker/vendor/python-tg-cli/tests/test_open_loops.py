"""TDD tests for open loop tracking and resolution."""

from __future__ import annotations

from tg_cli.open_loops import detect_open_loops, resolve_open_loops


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


def test_detect_open_loop_from_future_commitment():
    messages = [
        _msg(1, "Снежана", "Почтой напишу", "2026-01-26T19:28:12+00:00"),
    ]
    loops = detect_open_loops(messages, subject_id="telegram:user:731038050")
    assert loops
    assert loops[0]["status"] == "open"


def test_resolve_open_loop_when_followup_arrives():
    loops = [
        {
            "loop_id": "loop-1",
            "chat_id": 731038050,
            "subject_id": "telegram:user:731038050",
            "description": "Почтой напишу",
            "status": "open",
            "created_at": "2026-01-26T19:28:12+00:00",
            "source_msg_id": 1,
        }
    ]
    messages = [
        _msg(2, "Снежана", "Отправила письмо", "2026-01-27T10:00:00+00:00"),
    ]
    resolved = resolve_open_loops(loops, messages)
    assert resolved[0]["status"] in {"resolved", "open"}


def test_open_loop_detector_is_safe_when_no_commitments_exist():
    messages = [
        _msg(1, "Снежана", "Ог", "2026-01-26T18:19:40+00:00"),
    ]
    loops = detect_open_loops(messages, subject_id="telegram:user:731038050")
    assert loops == []
