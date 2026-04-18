"""Tests for safe explicit subject observation extraction."""

from __future__ import annotations

from datetime import datetime, timezone

from tg_cli.subject_observer import extract_subject_observations


def _message(text: str, msg_id: int = 1) -> dict:
    return {
        "sender_name": "Снежана",
        "content": text,
        "msg_id": msg_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def test_extract_work_observation():
    observations = extract_subject_observations(_message("Я сейчас работаю в цветочном магазине"))
    assert observations
    assert observations[0]["field"] == "work"


def test_extract_study_observation():
    observations = extract_subject_observations(_message("Я учусь в педагогическом университете"))
    assert any(item["field"] == "study" for item in observations)


def test_extract_city_observation():
    observations = extract_subject_observations(_message("Живу в Петербурге"))
    assert any(item["field"] == "city" for item in observations)


def test_extract_hobby_observation():
    observations = extract_subject_observations(_message("Люблю музыку и танцы"))
    assert any(item["field"] == "hobby" for item in observations)


def test_non_explicit_text_returns_no_observations():
    observations = extract_subject_observations(_message("Опять опоздала и всё бегом"))
    assert observations == []
