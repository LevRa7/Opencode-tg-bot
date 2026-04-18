"""Answer backends for tg ask.

This module defines the seam between dialog-session projection/prompt assembly
and the final answer synthesis backend.
"""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from .session_policy import preview_texts


class AnswerBackend(Protocol):
    name: str

    def answer(self, projection: dict[str, Any], prompt: str) -> dict[str, Any]: ...


@dataclass
class LocalSynthesisBackend:
    name: str = "local-synthesizer"

    def answer(self, projection: dict[str, Any], prompt: str) -> dict[str, Any]:
        chat_name = projection.get("chat_name") or str(projection.get("chat_id"))
        question = projection.get("question") or ""
        facts = projection.get("facts") or []
        segments = projection.get("segments") or []
        evidence = projection.get("evidence") or []
        recent_tail = projection.get("recent_tail") or []
        rolling = projection.get("rolling_summary")
        compacted = projection.get("compacted_summary")
        lines = [
            f"Question about {chat_name}: {question}",
            (
                f"This dialog currently spans {projection['session_meta'].get('message_count', 0)} messages "
                f"across {projection['session_meta'].get('segment_count', 0)} derived segments."
            ),
        ]
        if facts:
            lines.append("Most relevant derived facts:")
            for fact in facts[:4]:
                value = fact.get("object") or fact.get("value_json") or "—"
                lines.append(f"- {fact.get('predicate')}: {value}")
        if segments:
            lines.append("Relevant segments:")
            for segment in segments[:3]:
                lines.append(
                    f"- Segment {segment.get('seq')}: {segment.get('summary') or segment.get('topic_hint') or 'no summary'}"
                )
        if rolling:
            lines.append(f"Rolling summary: {rolling.get('summary')}")
        if compacted:
            lines.append(f"Compacted summary: {compacted.get('summary')}")
        tail_preview = preview_texts([message.get("content") or "" for message in recent_tail], limit=3)
        if tail_preview != "no text preview":
            lines.append(f"Recent tail preview: {tail_preview}")
        if evidence:
            refs = ", ".join(str(item["msg_id"]) for item in evidence[:6])
            lines.append(f"Evidence message ids: {refs}")
        return {
            "backend": {
                "mode": self.name,
                "llm_ready": True,
                "model": None,
            },
            "answer": "\n".join(lines),
            "prompt": prompt,
        }


class ClaudeClientProtocol(Protocol):
    def create_message(self, *, model: str, prompt: str, projection: dict[str, Any]) -> dict[str, Any]: ...


class DefaultClaudeClient:
    def __init__(self, api_key: str, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = (base_url or os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com").rstrip("/")

    def create_message(self, *, model: str, prompt: str, projection: dict[str, Any]) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.base_url}/v1/messages",
            data=json.dumps(
                {
                    "model": model,
                    "max_tokens": 1200,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt,
                        }
                    ],
                    "metadata": {
                        "projection_chat_id": str(projection.get("chat_id", "")),
                    },
                }
            ).encode(),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        with urllib.request.urlopen(req) as response:  # noqa: S310
            payload = json.loads(response.read().decode())
        text = ""
        for block in payload.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")
        return {
            "model": payload.get("model", model),
            "text": text,
        }


@dataclass
class ClaudeBackend:
    api_key: str | None = None
    client: ClaudeClientProtocol | None = None
    model: str = "claude-3-5-sonnet-latest"
    name: str = "claude"

    def answer(self, projection: dict[str, Any], prompt: str) -> dict[str, Any]:
        api_key = self.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for the Claude backend")
        client = self.client or DefaultClaudeClient(api_key)
        response = client.create_message(model=self.model, prompt=prompt, projection=projection)
        return {
            "backend": {
                "mode": self.name,
                "llm_ready": True,
                "model": response.get("model", self.model),
            },
            "answer": response.get("text", ""),
            "prompt": prompt,
        }


@dataclass
class StubLLMBackend:
    name: str
    model_name: str

    def answer(self, projection: dict[str, Any], prompt: str) -> dict[str, Any]:
        return {
            "backend": {
                "mode": self.name,
                "llm_ready": True,
                "model": self.model_name,
            },
            "answer": (
                "LLM backend stub selected. Projection and prompt are ready, but the "
                "network/model call has not been implemented yet."
            ),
            "prompt": prompt,
        }


def get_answer_backend(name: str | None = None) -> AnswerBackend:
    if not name or name == "local-synthesizer":
        return LocalSynthesisBackend()
    if name == "claude":
        return ClaudeBackend()
    if name == "opencode":
        return StubLLMBackend(name="opencode", model_name="opencode-backend-stub")
    raise ValueError(f"Unsupported ask backend: {name}")
