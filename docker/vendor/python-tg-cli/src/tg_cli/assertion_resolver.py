"""Resolve explicit observations into temporal assertions."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from .db import MessageDB

_DYNAMIC_FIELDS = {"work", "city", "study", "project", "routine"}


def apply_observation(db: MessageDB, *, subject_id: str, chat_id: int, observation: dict[str, Any]) -> str:
    field = observation["field"]
    value = observation["value"]
    observed_at = observation["observed_at"]
    source_msg_id = observation["source_msg_id"]

    active = db.get_active_assertions(subject_id, field=field)
    for existing in active:
        if existing["value"] == value:
            db.upsert_subject_assertion(
                assertion_id=existing["assertion_id"],
                subject_id=subject_id,
                chat_id=chat_id,
                field=field,
                value=value,
                status="active",
                confidence=max(float(existing.get("confidence") or 0), float(observation.get("confidence", 1.0))),
                valid_from_ts=existing.get("valid_from_ts"),
                valid_to_ts=None,
                first_seen_at=existing["first_seen_at"],
                last_seen_at=observed_at,
                supersedes_assertion_id=existing.get("supersedes_assertion_id"),
                source_type="explicit_statement",
                notes=existing.get("notes"),
            )
            db.link_assertion_evidence(
                assertion_id=existing["assertion_id"],
                source_msg_id=source_msg_id,
                evidence_type="supporting",
                observed_at=observed_at,
            )
            return existing["assertion_id"]

    supersedes = None
    if field in _DYNAMIC_FIELDS and active:
        for existing in active:
            db.upsert_subject_assertion(
                assertion_id=existing["assertion_id"],
                subject_id=subject_id,
                chat_id=existing["chat_id"],
                field=existing["field"],
                value=existing["value"],
                status="superseded",
                confidence=float(existing.get("confidence") or 1.0),
                valid_from_ts=existing.get("valid_from_ts"),
                valid_to_ts=observed_at,
                first_seen_at=existing["first_seen_at"],
                last_seen_at=observed_at,
                supersedes_assertion_id=existing.get("supersedes_assertion_id"),
                source_type=existing.get("source_type") or "explicit_statement",
                notes=existing.get("notes"),
            )
            supersedes = existing["assertion_id"]

    assertion_id = f"assert:{subject_id}:{field}:{uuid4().hex[:12]}"
    db.upsert_subject_assertion(
        assertion_id=assertion_id,
        subject_id=subject_id,
        chat_id=chat_id,
        field=field,
        value=value,
        status="active",
        confidence=float(observation.get("confidence", 1.0)),
        valid_from_ts=observed_at,
        valid_to_ts=None,
        first_seen_at=observed_at,
        last_seen_at=observed_at,
        supersedes_assertion_id=supersedes,
        source_type="explicit_statement",
        notes=observation.get("notes"),
    )
    db.link_assertion_evidence(
        assertion_id=assertion_id,
        source_msg_id=source_msg_id,
        evidence_type="direct",
        observed_at=observed_at,
    )
    return assertion_id


def resolve_field_current(db: MessageDB, subject_id: str, field: str) -> dict[str, Any] | None:
    active = db.get_active_assertions(subject_id, field=field)
    return active[0] if active else None


def resolve_field_as_of(db: MessageDB, subject_id: str, field: str, as_of: str) -> dict[str, Any] | None:
    historical = db.get_assertions_as_of(subject_id, field, as_of)
    return historical[0] if historical else None
