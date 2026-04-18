"""TDD roadmap tests for the remaining ask/session implementation steps.

These tests intentionally specify the target architecture in executable form:
1. backend abstraction
2. intent-aware routing
3. quote preservation
4. incremental rebuild
5. pluggable model backends

Some tests are expected to fail until the corresponding implementation step lands.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from conftest import make_msg
from tg_cli.db import MessageDB
from tg_cli.session_engine import DialogSessionEngine


class TestAskBackendAbstractionSpec:
    def test_ask_returns_backend_contract(self, db: MessageDB):
        """Why: once a real LLM is introduced, callers need a stable contract
        independent of the current local synthesizer. This test ensures `ask`
        always reports which backend answered and whether the payload is LLM-ready.
        """
        db.insert_message(**make_msg(msg_id=1, content="Project update for backend abstraction"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        result = engine.ask_chat(100, "Summarize the backend architecture")
        assert result["backend"]["mode"] == "local-synthesizer"
        assert result["backend"]["llm_ready"] is True
        assert result["projection"]
        assert result["prompt"]

    def test_projection_and_prompt_are_separate_outputs(self, db: MessageDB):
        """Why: projection assembly and prompt rendering must stay decoupled so a
        non-text backend (or structured JSON backend) can reuse projection without
        reparsing a prompt string.
        """
        db.insert_message(**make_msg(msg_id=1, content="Alpha architecture note"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        projection = engine.build_ask_projection(100, "What is alpha?")
        prompt = engine.render_ask_prompt(projection)
        assert projection["question"] == "What is alpha?"
        assert "Question:" in prompt
        assert projection["chat_name"] in prompt


class TestAskIntentRoutingSpec:
    def test_summary_question_prefers_rolling_and_compacted_context(self, db: MessageDB):
        """Why: summary questions should bias toward higher-level historical
        context instead of only recent tail snippets. This test protects future
        intent-aware routing behavior.
        """
        for i in range(1, 9):
            db.insert_message(**make_msg(msg_id=i, content=f"Sprint note {i} about platform migration"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        projection = engine.build_ask_projection(100, "Give me an overview of this dialog")
        assert projection["rolling_summary"] is not None
        # compaction may or may not exist for tiny chats, but the projection must at least expose the field
        assert "compacted_summary" in projection

    def test_people_question_surfaces_sender_related_facts(self, db: MessageDB):
        """Why: people-oriented questions should retrieve participant/activity
        memory, not just generic keywords. This guards the future intent router.
        """
        db.insert_message(**make_msg(msg_id=1, sender_id=1, sender_name="Alice", content="I will send the design"))
        db.insert_message(**make_msg(msg_id=2, sender_id=1, sender_name="Alice", content="Reminder about the design"))
        db.insert_message(**make_msg(msg_id=3, sender_id=2, sender_name="Bob", content="Looks good"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        projection = engine.build_ask_projection(100, "What did Alice mostly talk about?")
        predicates = {fact["predicate"] for fact in projection["facts"]}
        assert "top_sender" in predicates or "top_keywords" in predicates

    def test_evidence_question_keeps_nonempty_evidence_snippets(self, db: MessageDB):
        """Why: when the user asks for proof or grounding, the projection must
        preserve source snippets rather than only derived summaries.
        """
        db.insert_message(**make_msg(msg_id=1, content="We agreed to ship on Friday"))
        db.insert_message(**make_msg(msg_id=2, content="Please remind me on Thursday"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        projection = engine.build_ask_projection(100, "What evidence shows a deadline?")
        assert projection["evidence"]
        assert projection["evidence"][0]["content"]


class TestQuotePreservationSpec:
    def test_projection_contains_recent_tail_quotes(self, db: MessageDB):
        """Why: LLMs answer better when they see raw excerpts in addition to
        summaries. This prevents the system from collapsing everything into
        abstractions too early.
        """
        for i in range(1, 6):
            db.insert_message(**make_msg(msg_id=i, content=f"Direct quote line {i}"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        projection = engine.build_ask_projection(100, "What are the latest direct quotes?")
        assert projection["recent_tail"]
        assert all("content" in item for item in projection["recent_tail"])

    def test_projection_contains_evidence_snippets_with_message_ids(self, db: MessageDB):
        """Why: preserved snippets must stay traceable back to source messages,
        otherwise future LLM answers become unverifiable.
        """
        db.insert_message(**make_msg(msg_id=1, content="Need to revisit the budget tomorrow"))
        db.insert_message(**make_msg(msg_id=2, content="Sending the budget sheet later"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        projection = engine.build_ask_projection(100, "Show me the important quotes about budget")
        assert projection["evidence"]
        assert all("msg_id" in item for item in projection["evidence"])


class TestIncrementalRebuildSpec:
    def test_session_stores_last_processed_raw_message(self, db: MessageDB):
        """Why: incremental rebuild needs a cursor anchor. This test makes sure
        session metadata exposes that anchor before the optimization is wired in.
        """
        db.insert_message(**make_msg(msg_id=1, content="Initial sync event"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)
        session = db.get_dialog_session(100)
        assert session["last_raw_msg_id"] == 1

    def test_rebuild_after_new_tail_message_advances_cursor(self, db: MessageDB):
        """Why: even before true incremental recomputation is implemented, we need
        observable state proving that rebuilds can detect newly appended tail data.
        """
        db.insert_message(**make_msg(msg_id=1, content="Old state"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)
        first_session = db.get_dialog_session(100)

        db.insert_message(**make_msg(msg_id=2, content="New tail state"))
        engine.build_for_chat(100)
        second_session = db.get_dialog_session(100)
        assert first_session["last_raw_msg_id"] == 1
        assert second_session["last_raw_msg_id"] == 2


class TestPluggableBackendSpec:
    def test_local_backend_shape_is_ready_for_future_backend_swap(self, db: MessageDB):
        """Why: when Claude/OpenCode backends are added, the result payload shape
        must remain stable for CLI users and agent callers.
        """
        db.insert_message(**make_msg(msg_id=1, content="Local backend fallback answer"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        result = engine.ask_chat(100, "What is the current fallback backend?")
        assert result["backend"]["mode"] == "local-synthesizer"
        assert result["answer"]
        assert result["projection"]
        assert result["prompt"]

    def test_future_backend_api_should_accept_projection_and_prompt(self, db: MessageDB):
        """Why: this is the critical seam for plugging in a real model. The test
        codifies the handoff shape before the backend module exists.
        """
        db.insert_message(**make_msg(msg_id=1, content="Prompt handoff contract"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)

        projection = engine.build_ask_projection(100, "Explain the handoff")
        prompt = engine.render_ask_prompt(projection)
        assert isinstance(projection, dict)
        assert isinstance(prompt, str)
        assert projection["chat_id"] == 100
        assert "Question:" in prompt

    def test_backend_factory_supports_future_model_backends(self):
        """Why: the backend seam is only useful if callers can select future
        backends now, even before the real network calls exist.
        """
        from tg_cli.ask_backends import get_answer_backend

        assert get_answer_backend("local-synthesizer").name == "local-synthesizer"
        assert get_answer_backend("claude").name == "claude"
        assert get_answer_backend("opencode").name == "opencode"

    def test_claude_backend_requires_api_key(self):
        """Why: a real Claude backend must fail fast and clearly when auth is
        missing, otherwise CLI users get opaque downstream errors.
        """
        import os

        from tg_cli.ask_backends import get_answer_backend

        os.environ.pop("ANTHROPIC_API_KEY", None)
        backend = get_answer_backend("claude")
        with pytest.raises(ValueError):
            backend.answer({"question": "hi", "session_meta": {}}, "prompt")

    def test_claude_backend_can_use_injected_client(self):
        """Why: testability and future provider portability both depend on an
        injectable client seam rather than hardwiring HTTP calls deep inside the backend.
        """
        from tg_cli.ask_backends import ClaudeBackend

        class FakeClaudeClient:
            def create_message(self, *, model, prompt, projection):
                return {
                    "model": model,
                    "text": "Claude synthesized answer",
                }

        backend = ClaudeBackend(api_key="test-key", client=FakeClaudeClient(), model="claude-test")
        result = backend.answer(
            {
                "question": "What happened?",
                "session_meta": {"message_count": 2, "segment_count": 1},
            },
            "Prompt text",
        )
        assert result["backend"]["mode"] == "claude"
        assert result["backend"]["model"] == "claude-test"
        assert result["answer"] == "Claude synthesized answer"

    def test_default_claude_client_uses_base_url_and_parses_response(self, monkeypatch):
        """Why: the real backend must be able to talk to an Anthropic-compatible
        HTTP endpoint using env-provided base URL and parse text out of the response.
        """
        import json

        from tg_cli.ask_backends import DefaultClaudeClient

        captured = {}

        class FakeResponse:
            def read(self):
                return json.dumps({
                    "content": [{"type": "text", "text": "Real Claude transport answer"}],
                    "model": "gpt-5.4"
                }).encode()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def fake_urlopen(req):
            captured["url"] = req.full_url
            captured["headers"] = dict(req.header_items())
            captured["body"] = json.loads(req.data.decode())
            return FakeResponse()

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
        client = DefaultClaudeClient(api_key="test-key", base_url="http://127.0.0.1")
        response = client.create_message(model="gpt-5.4-mini", prompt="Prompt text", projection={"x": 1})
        assert captured["url"].startswith("http://127.0.0.1")
        assert "messages" in captured["url"]
        assert captured["body"]["model"] == "gpt-5.4-mini"
        assert response["text"] == "Real Claude transport answer"
