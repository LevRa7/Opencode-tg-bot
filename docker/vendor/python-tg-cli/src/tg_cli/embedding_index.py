"""Embedding metadata builders and local HTTP embedding client."""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from math import sqrt
from typing import Any

from .db import MessageDB

_DEFAULT_BASE_URL = "http://127.0.0.1:8000"
_DEFAULT_DIMENSIONS = 768


@dataclass
class LocalEmbeddingHTTPClient:
    base_url: str = _DEFAULT_BASE_URL
    dimensions: int = _DEFAULT_DIMENSIONS

    def health(self) -> dict[str, Any]:
        with urllib.request.urlopen(f"{self.base_url}/health") as response:  # noqa: S310
            return json.loads(response.read().decode())

    def embed(self, texts: list[str]) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.base_url}/embed",
            data=json.dumps({"texts": texts}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as response:  # noqa: S310
            return json.loads(response.read().decode())


def get_embedding_client(base_url: str = _DEFAULT_BASE_URL) -> LocalEmbeddingHTTPClient:
    return LocalEmbeddingHTTPClient(base_url=base_url)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sqrt(sum(x * x for x in a))
    norm_b = sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def build_embedding_documents_for_chat(db: MessageDB, chat_id: int) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    docs: list[dict[str, Any]] = []

    summaries = db.get_dialog_summaries(chat_id)
    for summary in summaries:
        docs.append(
            {
                "doc_id": f"chat:{chat_id}/summary:{summary['summary_id']}",
                "chat_id": chat_id,
                "subject_id": None,
                "source_type": "summary",
                "source_id": summary["summary_id"],
                "content": summary["summary"],
                "created_at": summary.get("created_at") or now,
                "updated_at": summary.get("created_at") or now,
                "is_active": True,
            }
        )

    facts = db.get_dialog_facts(chat_id)
    for fact in facts:
        docs.append(
            {
                "doc_id": f"chat:{chat_id}/fact:{fact['fact_id']}",
                "chat_id": chat_id,
                "subject_id": None,
                "source_type": "fact",
                "source_id": fact["fact_id"],
                "content": f"{fact.get('predicate')}: {fact.get('object') or fact.get('value_json') or ''}",
                "created_at": fact.get("created_at") or now,
                "updated_at": fact.get("created_at") or now,
                "is_active": fact.get("status", "active") == "active",
            }
        )

    for assertion in db.get_active_assertions(f"telegram:user:{chat_id}"):
        docs.append(
            {
                "doc_id": f"subject:{assertion['subject_id']}/assertion:{assertion['assertion_id']}",
                "chat_id": chat_id,
                "subject_id": assertion["subject_id"],
                "source_type": "assertion",
                "source_id": assertion["assertion_id"],
                "content": f"{assertion['field']}: {assertion['value']}",
                "created_at": assertion.get("first_seen_at") or now,
                "updated_at": assertion.get("last_seen_at") or now,
                "is_active": assertion.get("status") == "active",
            }
        )

    for message in db.get_chat_messages(chat_id, limit=20)[-5:]:
        if not (message.get("content") or "").strip():
            continue
        docs.append(
            {
                "doc_id": f"chat:{chat_id}/msg:{message['msg_id']}/quote",
                "chat_id": chat_id,
                "subject_id": None,
                "source_type": "quote",
                "source_id": str(message["msg_id"]),
                "content": (message.get("content") or "")[:280],
                "created_at": message.get("timestamp") or now,
                "updated_at": message.get("timestamp") or now,
                "is_active": not bool(message.get("is_deleted")),
            }
        )

    return docs


def sync_embeddings_for_chat(
    db: MessageDB,
    chat_id: int,
    *,
    client: LocalEmbeddingHTTPClient | None = None,
    model_id: str = "local-embed",
) -> int:
    now = datetime.now(timezone.utc).isoformat()
    docs = build_embedding_documents_for_chat(db, chat_id)
    if not docs:
        return 0
    client = client or get_embedding_client()
    payload = client.embed([doc["content"] for doc in docs])
    embeddings = payload.get("embeddings", [])
    synced = 0
    for doc, vector in zip(docs, embeddings):
        db.upsert_embedding_document(**doc)
        db.insert_embedding_vector(
            doc_id=doc["doc_id"],
            model_id=model_id,
            vector_blob=json.dumps(vector).encode(),
            created_at=now,
        )
        synced += 1
    return synced


def semantic_search(
    db: MessageDB,
    *,
    chat_id: int,
    query: str,
    top_k: int = 5,
    client: LocalEmbeddingHTTPClient | None = None,
    model_id: str = "local-embed",
) -> list[dict[str, Any]]:
    client = client or get_embedding_client()
    try:
        query_payload = client.embed([query])
    except Exception:
        return []
    query_vec = (query_payload.get("embeddings") or [[None]])[0]
    if not query_vec:
        return []
    docs = {doc["doc_id"]: doc for doc in db.list_active_embedding_docs(chat_id=chat_id)}
    rows = db.conn.execute(
        "SELECT * FROM embedding_vectors WHERE model_id = ? ORDER BY id ASC",
        (model_id,),
    ).fetchall()
    hits: list[dict[str, Any]] = []
    for row in rows:
        doc = docs.get(row["doc_id"])
        if not doc:
            continue
        vector = json.loads(row["vector_blob"].decode())
        score = _cosine_similarity(query_vec, vector)
        hits.append(
            {
                "doc_id": doc["doc_id"],
                "source_type": doc["source_type"],
                "source_id": doc["source_id"],
                "content": doc["content"],
                "score": score,
                "freshness": 1.0,
            }
        )
    hits.sort(key=lambda item: item["score"], reverse=True)
    return hits[:top_k]
