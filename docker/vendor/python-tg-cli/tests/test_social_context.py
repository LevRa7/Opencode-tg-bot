"""TDD tests for social context extraction and projection integration."""

from __future__ import annotations

from tg_cli.social_graph_extractor import extract_social_context
from tg_cli.session_engine import DialogSessionEngine
from conftest import make_msg


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


def test_extract_social_context_finds_third_party_people_mentions():
    messages = [
        _msg(1, "Лев", "Сначала Серега заболел, потом Крис, а после и мы с Ингой", "2026-01-26T22:47:12+00:00"),
    ]
    context = extract_social_context(messages, chat_id=731038050)
    names = {item["name"] for item in context["people"]}
    assert "Серега" in names
    assert "Крис" in names
    assert "Инга" in names


def test_extract_social_context_marks_common_acquaintance_candidates():
    messages = [
        _msg(1, "Лев", "Сначала Серега заболел, потом Крис", "2026-01-26T22:47:12+00:00"),
        _msg(2, "Снежана", "Вам жуть", "2026-01-27T01:19:25+00:00"),
    ]
    context = extract_social_context(messages, chat_id=731038050)
    assert context["common_acquaintance_candidates"]


def test_extract_social_context_marks_close_contact_signals():
    messages = [
        _msg(1, "Лев", "Сначала Серега заболел, потом Крис, а после и мы с Ингой", "2026-01-26T22:47:12+00:00"),
        _msg(2, "Лев", "у нас это - коллективное)", "2026-01-26T22:47:32+00:00"),
    ]
    context = extract_social_context(messages, chat_id=731038050)
    assert context["close_contact_signals"]


def test_projection_can_include_social_context(db):
    db.insert_message(**make_msg(msg_id=1, sender_name="Лев", content="Сначала Серега заболел, потом Крис, а после и мы с Ингой", hours_ago=2))
    db.insert_message(**make_msg(msg_id=2, sender_name="Лев", content="у нас это - коллективное)", hours_ago=1.9))
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    projection = engine.build_ask_projection(100, "Кто у нас общие знакомые?")
    assert "social_context" in projection
