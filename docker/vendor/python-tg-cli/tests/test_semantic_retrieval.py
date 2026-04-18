"""TDD tests for semantic embedding sync and search."""

from __future__ import annotations

import json

from tg_cli.embedding_index import build_embedding_documents_for_chat, get_embedding_client, semantic_search, sync_embeddings_for_chat
from tg_cli.assertion_resolver import apply_observation
from tg_cli.session_engine import DialogSessionEngine
from conftest import make_msg


class _FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_embedding_client_embed_parses_vectors(monkeypatch):
    client = get_embedding_client()
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *args, **kwargs: _FakeResponse({"embeddings": [[0.1, 0.2], [0.3, 0.4]]}),
    )
    payload = client.embed(["Привет", "Мир"])
    assert len(payload["embeddings"]) == 2


def test_sync_embeddings_for_chat_stores_vectors(db, monkeypatch):
    db.insert_message(**make_msg(msg_id=1, content="Очень длинное техническое объяснение"))
    apply_observation(
        db,
        subject_id="telegram:user:100",
        chat_id=100,
        observation={
            "field": "work",
            "value": "бариста",
            "confidence": 1.0,
            "observed_at": "2026-02-01T00:00:00+00:00",
            "source_msg_id": 1,
        },
    )
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *args, **kwargs: _FakeResponse({"embeddings": [[0.1, 0.2, 0.3] for _ in range(20)]}),
    )
    synced = sync_embeddings_for_chat(db, 100)
    assert synced > 0


def test_semantic_search_returns_ranked_hits_from_active_docs(db, monkeypatch):
    db.upsert_embedding_document(
        doc_id="doc1",
        chat_id=100,
        subject_id=None,
        source_type="summary",
        source_id="s1",
        content="Краткое summary про работу и проект",
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
        is_active=True,
    )
    db.insert_embedding_vector(
        doc_id="doc1",
        model_id="local-embed",
        vector_blob=json.dumps([1.0, 0.0]).encode(),
        created_at="2026-01-01T00:00:00+00:00",
    )
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *args, **kwargs: _FakeResponse({"embeddings": [[1.0, 0.0]]}),
    )
    hits = semantic_search(db, chat_id=100, query="работа", top_k=5)
    assert hits
    assert hits[0]["doc_id"] == "doc1"


def test_projection_can_be_augmented_with_semantic_hits(db, monkeypatch):
    db.insert_message(**make_msg(msg_id=1, content="Очень длинное техническое объяснение про систему"))
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *args, **kwargs: _FakeResponse({"embeddings": [[0.1, 0.2, 0.3] for _ in range(20)]}),
    )
    sync_embeddings_for_chat(db, 100)
    hits = semantic_search(db, chat_id=100, query="система", top_k=5)
    assert isinstance(hits, list)

    projection = engine.build_ask_projection(100, "Что там было про систему?")
    assert "semantic_hits" in projection
    assert isinstance(projection["semantic_hits"], list)
