"""TDD tests for ontology-style extractors and graph storage."""

from __future__ import annotations

from tg_cli.ontology_extractors import extract_bond_components, extract_constraints, extract_goals, extract_location_signals, extract_occupation_or_project_signals


def _message(text: str, msg_id: int = 1, sender_name: str = "Снежана") -> dict:
    return {
        "chat_id": 731038050,
        "msg_id": msg_id,
        "sender_name": sender_name,
        "content": text,
        "timestamp": "2026-01-26T19:28:12+00:00",
    }


def test_extract_goal_from_want_statement():
    goals = extract_goals(_message("Я хочу в шлисс уехать скорее"))
    assert goals
    assert any("шлисс" in item["label"].lower() for item in goals)


def test_extract_constraint_from_difficulty_statement():
    constraints = extract_constraints(_message("Там одному сложно (долго) вытягивать"))
    assert constraints


def test_extract_location_signal_distinguishes_travel_intent():
    locations = extract_location_signals(_message("Я сейчас в Шлиссельбург хочу поехать"))
    assert locations
    assert locations[0]["signal_type"] in {"travel_intent", "current_location"}


def test_extract_occupation_or_project_signal_from_project_statement():
    projects = extract_occupation_or_project_signals(_message("Хочу доделать распознавание лиц"))
    assert projects


def test_extract_bond_components_from_relational_message_mix():
    messages = [
        _message("Чуть без души", 1),
        _message("А так круто", 2),
        _message("Стрем", 3),
        _message("Что с тобой и почему", 4),
    ]
    bond = extract_bond_components(messages)
    assert bond
