"""TDD coverage for the next tg-cli architecture phases.

These tests define the target implementation contract for:
1. event-sourced message history
2. subject observation layer
3. temporal assertion resolver
4. interaction analytics
5. session projection v2
6. embedding metadata
7. hybrid retrieval
8. debug/inspection commands
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from conftest import make_msg
from tg_cli.db import MessageDB
from tg_cli.session_engine import DialogSessionEngine


class TestEventSourcedMessageHistorySpec:
    def test_db_should_expose_message_event_tables_after_migration(self, db: MessageDB):
        """Why: we need durable event-sourced storage before we can track edits,
        deletes, reactions, and read observations over time.
        """
        # Expected future contract; currently may fail until migrations are added.
        table_names = {
            row[0]
            for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        assert "message_events" in table_names
        assert "message_versions" in table_names
        assert "message_reads" in table_names
        assert "message_reactions" in table_names
        assert "sync_state" in table_names

    def test_message_edit_should_preserve_previous_versions(self, db: MessageDB):
        """Why: edited messages are analytically meaningful; we need the original
        wording and later versions for relationship/task analysis.
        """
        db.insert_message(**make_msg(msg_id=1, content="old text"))
        # Target contract: observer/updater should create version history.
        assert hasattr(db, "insert_message_version")

    def test_message_delete_should_mark_canonical_state_not_erase_history(self, db: MessageDB):
        """Why: deleted content is part of interaction history if it was previously
        observed; deletion should become an event, not silent disappearance.
        """
        db.insert_message(**make_msg(msg_id=1, content="temporary text"))
        assert hasattr(db, "mark_message_deleted")


class TestSubjectObservationSpec:
    def test_explicit_work_statement_should_become_observation(self):
        """Why: explicit self-statements should be captured as observations before
        we derive active assertions from them.
        """
        import importlib

        module = importlib.import_module("tg_cli.subject_observer")
        observations = module.extract_subject_observations(
            {
                "sender_name": "Снежана",
                "content": "Я сейчас работаю в цветочном магазине",
                "msg_id": 10,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        assert observations
        assert any(item["field"] == "work" for item in observations)

    def test_non_explicit_guess_should_not_become_observation(self):
        """Why: we want an explicit-statement policy, not speculative profiling.
        """
        import importlib

        module = importlib.import_module("tg_cli.subject_observer")
        observations = module.extract_subject_observations(
            {
                "sender_name": "Снежана",
                "content": "Опоздала опять на встречу",
                "msg_id": 11,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        assert observations == []


class TestTemporalAssertionResolverSpec:
    def test_new_assertion_should_supersede_old_dynamic_value(self, db: MessageDB):
        """Why: mutable fields like work/city must not stick forever once newer
        evidence appears.
        """
        assert hasattr(db, "upsert_subject_assertion")
        assert hasattr(db, "get_active_assertions")

    def test_assertion_resolution_as_of_date_should_return_historical_value(self, db: MessageDB):
        """Why: historical analysis needs time-scoped truth, not only current truth.
        """
        assert hasattr(db, "get_assertions_as_of")


class TestInteractionAnalyticsSpec:
    def test_interaction_metrics_should_capture_response_latency(self, db: MessageDB):
        """Why: latency is one of the strongest behavioral signals in dialog dynamics.
        """
        assert hasattr(db, "upsert_interaction_metric_day")

    def test_interaction_patterns_should_allow_caring_response_pattern(self, db: MessageDB):
        """Why: support/care dynamics should be represented as interaction patterns,
        not hidden inside generic summaries.
        """
        assert hasattr(db, "insert_interaction_pattern")

    def test_interaction_analyzer_module_should_exist(self):
        """Why: analytics should live in a dedicated module, not leak into
        session_engine or client transport code.
        """
        import importlib

        module = importlib.import_module("tg_cli.interaction_analyzer")
        assert hasattr(module, "analyze_interaction_metrics")
        assert hasattr(module, "analyze_interaction_patterns")


class TestSessionProjectionV2Spec:
    def test_projection_should_include_active_assertions_once_subject_layer_exists(self, db: MessageDB):
        """Why: current ask projections need person/state context alongside facts and segments.
        """
        db.insert_message(**make_msg(msg_id=1, content="Базовое сообщение"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)
        projection = engine.build_ask_projection(100, "Что известно о человеке сейчас?")
        assert "active_assertions" in projection

    def test_projection_should_include_interaction_patterns(self, db: MessageDB):
        """Why: ask answers about relationship dynamics should directly consume
        structured interaction patterns.
        """
        db.insert_message(**make_msg(msg_id=1, content="Тест"))
        engine = DialogSessionEngine(db)
        engine.build_for_chat(100)
        projection = engine.build_ask_projection(100, "Какой у нас стиль общения?")
        assert "interaction_patterns" in projection


class TestEmbeddingMetadataSpec:
    def test_embedding_documents_should_exist_for_semantic_units_not_full_log(self, db: MessageDB):
        """Why: embedding every raw message is noisy and expensive; we want semantic units.
        """
        table_names = {
            row[0]
            for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        assert "embedding_documents" in table_names
        assert "embedding_vectors" in table_names
        assert "embedding_models" in table_names

    def test_superseded_assertion_should_be_marked_inactive_for_embedding_retrieval(self, db: MessageDB):
        """Why: old dynamic facts must not dominate semantic retrieval after they become stale.
        """
        assert hasattr(db, "upsert_embedding_document")
        assert hasattr(db, "list_active_embedding_docs")


class TestHybridRetrievalSpec:
    def test_hybrid_retrieval_should_merge_structured_and_semantic_hits(self):
        """Why: best quality comes from structured-first retrieval plus semantic expansion.
        """
        import importlib

        module = importlib.import_module("tg_cli.retrieval")
        assert hasattr(module, "retrieve_context")

    def test_hybrid_retrieval_should_dedup_same_message_from_multiple_channels(self):
        """Why: the same message can appear as evidence, preserved quote, and semantic hit;
        dedup is required to save tokens and avoid noisy prompts.
        """
        import importlib

        module = importlib.import_module("tg_cli.retrieval")
        assert hasattr(module, "dedup_retrieval_items")


class TestDebugInspectionSpec:
    def test_cli_should_eventually_expose_projection_command(self):
        """Why: projection debugging is essential for validating retrieval quality and token usage.
        """
        import importlib

        session_cli = importlib.import_module("tg_cli.cli.session")
        assert hasattr(session_cli, "session_group")

    def test_cli_should_eventually_expose_subject_and_event_inspection(self):
        """Why: without inspection tools, stale assertions and event drift are hard to debug.
        """
        import importlib

        session_cli = importlib.import_module("tg_cli.cli.session")
        assert hasattr(session_cli, "session_group")
