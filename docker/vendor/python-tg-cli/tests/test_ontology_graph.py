"""TDD tests for ontology graph storage and projection integration."""

from __future__ import annotations

from tg_cli.session_engine import DialogSessionEngine
from conftest import make_msg


def test_ontology_graph_tables_exist(db):
    table_names = {
        row[0]
        for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "ontology_entities" in table_names
    assert "ontology_relations" in table_names
    assert "ontology_evidence" in table_names


def test_can_store_entity_relation_and_evidence(db):
    db.upsert_ontology_entity(
        entity_id="goal:1",
        entity_type="goal",
        label="уехать в Шлисс",
        status="active",
        created_at="2026-01-26T00:00:00+00:00",
        updated_at="2026-01-26T00:00:00+00:00",
    )
    db.upsert_ontology_relation(
        relation_id="rel:1",
        subject_entity_id="subject:731038050",
        predicate="wants",
        object_entity_id="goal:1",
        object_value=None,
        confidence=0.9,
        status="active",
        valid_from_ts="2026-01-26T00:00:00+00:00",
        valid_to_ts=None,
        created_at="2026-01-26T00:00:00+00:00",
        updated_at="2026-01-26T00:00:00+00:00",
    )
    db.link_ontology_evidence(
        relation_id="rel:1",
        source_msg_id=10,
        evidence_type="direct",
        observed_at="2026-01-26T00:00:00+00:00",
    )
    relations = db.list_ontology_relations()
    evidence = db.list_ontology_evidence("rel:1")
    assert relations[0]["predicate"] == "wants"
    assert evidence[0]["source_msg_id"] == 10


def test_projection_can_include_ontology_context(db):
    db.insert_message(**make_msg(msg_id=1, content="Я хочу в шлисс уехать скорее"))
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    projection = engine.build_ask_projection(100, "Какие у неё цели?")
    assert "ontology_context" in projection
