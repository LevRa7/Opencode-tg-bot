"""Hybrid retrieval helpers for structured and semantic context assembly."""

from __future__ import annotations

from typing import Any


def dedup_retrieval_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[tuple[Any, Any], dict[str, Any]] = {}
    for item in items:
        key = (item.get("msg_id") if item.get("msg_id") is not None else item.get("source_id"), item.get("msg_id") is not None)
        existing = best.get(key)
        if existing is None or float(item.get("score", 0)) > float(existing.get("score", 0)):
            best[key] = item
    return list(best.values())


def rerank_retrieval_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        items,
        key=lambda item: (float(item.get("score", 0)), float(item.get("freshness", 0))),
        reverse=True,
    )


def retrieve_context(
    *,
    structured_items: list[dict[str, Any]],
    semantic_items: list[dict[str, Any]],
) -> dict[str, Any]:
    merged = dedup_retrieval_items([*structured_items, *semantic_items])
    reranked = rerank_retrieval_items(merged)
    return {
        "items": reranked,
        "structured_count": len(structured_items),
        "semantic_count": len(semantic_items),
    }
