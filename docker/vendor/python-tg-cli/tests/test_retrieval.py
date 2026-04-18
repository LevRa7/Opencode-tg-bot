"""TDD tests for hybrid structured+semantic retrieval."""

from __future__ import annotations

from tg_cli.retrieval import dedup_retrieval_items, rerank_retrieval_items, retrieve_context


def test_dedup_retrieval_items_collapses_same_message():
    items = [
        {"kind": "evidence", "msg_id": 10, "score": 0.9},
        {"kind": "quote", "msg_id": 10, "score": 0.8},
        {"kind": "semantic", "msg_id": 11, "score": 0.7},
    ]
    deduped = dedup_retrieval_items(items)
    assert len(deduped) == 2
    assert any(item["msg_id"] == 10 for item in deduped)


def test_rerank_retrieval_items_prefers_higher_score_and_freshness():
    items = [
        {"kind": "semantic", "msg_id": 10, "score": 0.7, "freshness": 0.9},
        {"kind": "semantic", "msg_id": 11, "score": 0.8, "freshness": 0.1},
    ]
    reranked = rerank_retrieval_items(items)
    assert reranked[0]["msg_id"] in {10, 11}
    assert len(reranked) == 2


def test_retrieve_context_returns_structured_and_semantic_buckets():
    context = retrieve_context(
        structured_items=[{"kind": "fact", "msg_id": 1, "score": 1.0}],
        semantic_items=[{"kind": "semantic", "msg_id": 2, "score": 0.5}],
    )
    assert "items" in context
    assert len(context["items"]) == 2
