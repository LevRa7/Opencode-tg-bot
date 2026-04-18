"""TDD tests for embedding metadata and local HTTP embedding client."""

from __future__ import annotations

import json
from urllib.error import HTTPError

from tg_cli.embedding_index import build_embedding_documents_for_chat, get_embedding_client
from tg_cli.assertion_resolver import apply_observation
from tg_cli.session_engine import DialogSessionEngine
from conftest import make_msg


def test_get_embedding_client_uses_local_http_defaults():
    client = get_embedding_client()
    assert client.base_url.startswith("http://127.0.0.1:8000")
    assert client.dimensions == 768


def test_embedding_client_parses_health_payload(monkeypatch):
    from tg_cli.embedding_index import LocalEmbeddingHTTPClient

    client = LocalEmbeddingHTTPClient(base_url="http://127.0.0.1:8000")

    class FakeResponse:
        def read(self):
            return json.dumps({"status": "ok", "model": "google/embeddinggemma-300m", "dimensions": 768}).encode()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: FakeResponse())
    payload = client.health()
    assert payload["status"] == "ok"
    assert payload["dimensions"] == 768


def test_build_embedding_documents_uses_semantic_units(db):
    db.insert_message(**make_msg(msg_id=1, content="Привет 🙂"))
    db.insert_message(**make_msg(msg_id=2, content="Очень длинное техническое объяснение про систему"))
    apply_observation(
        db,
        subject_id="telegram:user:100",
        chat_id=100,
        observation={
            "field": "work",
            "value": "бариста",
            "confidence": 1.0,
            "observed_at": "2026-02-01T00:00:00+00:00",
            "source_msg_id": 2,
        },
    )
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    docs = build_embedding_documents_for_chat(db, 100)
    source_types = {doc["source_type"] for doc in docs}
    assert "summary" in source_types
    assert "quote" in source_types
    assert "assertion" in source_types


def test_superseded_assertion_docs_can_be_marked_inactive(db):
    db.upsert_embedding_document(
        doc_id="assert:old",
        chat_id=100,
        subject_id="telegram:user:100",
        source_type="assertion",
        source_id="assert:old",
        content="old assertion",
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
        is_active=False,
    )
    db.upsert_embedding_document(
        doc_id="assert:new",
        chat_id=100,
        subject_id="telegram:user:100",
        source_type="assertion",
        source_id="assert:new",
        content="new assertion",
        created_at="2026-02-01T00:00:00+00:00",
        updated_at="2026-02-01T00:00:00+00:00",
        is_active=True,
    )
    active_docs = db.list_active_embedding_docs(chat_id=100)
    assert len(active_docs) == 1
    assert active_docs[0]["doc_id"] == "assert:new"
