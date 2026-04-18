"""Derived dialog session engine built on top of raw tg-cli messages."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .ask_backends import AnswerBackend, get_answer_backend
from .ask_intent import classify_question
from .assertion_resolver import resolve_field_as_of, resolve_field_current
from .db import MessageDB
from .embedding_index import semantic_search
from .interaction_analyzer import analyze_interaction_metrics, analyze_interaction_patterns
from .ontology_extractors import extract_bond_components, extract_constraints, extract_goals, extract_location_signals, extract_occupation_or_project_signals
from .open_loops import detect_open_loops
from .profile_media_extractors import extract_message_media, extract_message_repost
from .retrieval import retrieve_context
from .social_graph_extractor import extract_social_context
from .session_policy import (
    COMPACTION_EXTRA_SALIENCE_SEGMENTS,
    COMPACTION_MIN_SEGMENTS,
    COMPACTION_PRESERVED_TAIL,
    MIN_MESSAGES_PER_SEGMENT,
    SEGMENT_GAP_HOURS,
    SEGMENT_SOFT_GAP_HOURS,
    contains_link,
    looks_like_open_loop,
    preview_texts,
    top_keywords,
)


@dataclass
class SessionBuildResult:
    chat_id: int
    chat_name: str
    session_id: str
    message_count: int
    segment_count: int
    fact_count: int
    summary_count: int
    compacted: bool


@dataclass
class _Segment:
    seq: int
    messages: list[dict[str, Any]]

    @property
    def start(self) -> dict[str, Any]:
        return self.messages[0]

    @property
    def end(self) -> dict[str, Any]:
        return self.messages[-1]


class DialogSessionEngine:
    def __init__(self, db: MessageDB, *, answer_backend: AnswerBackend | None = None):
        self.db = db
        self.answer_backend = answer_backend or get_answer_backend()

    def build_for_chat(self, chat_id: int) -> SessionBuildResult:
        messages = self.db.get_chat_messages(chat_id)
        if not messages:
            raise ValueError(f"No stored messages for chat_id {chat_id}")

        existing = self.db.get_dialog_session(chat_id)
        session_id = existing["session_id"] if existing else f"telegram:{chat_id}"
        chat_name = messages[-1].get("chat_name") or messages[0].get("chat_name") or str(chat_id)
        now = datetime.now(timezone.utc).isoformat()

        if existing and existing.get("last_raw_msg_id") == messages[-1]["msg_id"]:
            return SessionBuildResult(
                chat_id=chat_id,
                chat_name=chat_name,
                session_id=session_id,
                message_count=len(messages),
                segment_count=existing.get("segment_count", 0),
                fact_count=len(self.db.get_dialog_facts(chat_id)),
                summary_count=len(self.db.get_dialog_summaries(chat_id)),
                compacted=bool(self.db.get_dialog_compactions(chat_id)),
            )

        segments = self._segment_messages(messages)
        segment_rows, summary_rows, fact_rows, evidence_rows = self._build_artifacts(
            session_id=session_id,
            chat_id=chat_id,
            chat_name=chat_name,
            segments=segments,
            created_at=now,
        )
        compacted, compaction_row = self._build_compaction(
            session_id=session_id,
            chat_id=chat_id,
            summary_rows=summary_rows,
            evidence_rows=evidence_rows,
            segments=segments,
            created_at=now,
        )

        session_row = {
            "session_id": session_id,
            "platform": "telegram",
            "chat_id": chat_id,
            "chat_name": chat_name,
            "dialog_type": self._infer_dialog_type(messages),
            "first_msg_ts": messages[0]["timestamp"],
            "last_msg_ts": messages[-1]["timestamp"],
            "message_count": len(messages),
            "segment_count": len(segment_rows),
            "last_raw_msg_id": messages[-1]["msg_id"],
            "last_built_at": now,
            "compacted_msg_id": compaction_row.get("covered_until_msg_id") if compaction_row else None,
            "last_compaction_at": compaction_row.get("created_at") if compaction_row else None,
        }

        self.db.upsert_dialog_session(session_row)
        self.db.replace_dialog_segments(chat_id, segment_rows)
        self.db.replace_dialog_summaries(chat_id, summary_rows)
        self.db.replace_dialog_facts(chat_id, fact_rows)
        self.db.replace_dialog_evidence(chat_id, evidence_rows)
        if compaction_row is not None:
            self.db.insert_dialog_compaction(compaction_row)

        return SessionBuildResult(
            chat_id=chat_id,
            chat_name=chat_name,
            session_id=session_id,
            message_count=len(messages),
            segment_count=len(segment_rows),
            fact_count=len(fact_rows),
            summary_count=len(summary_rows),
            compacted=compacted,
        )

    def build_all(self) -> list[SessionBuildResult]:
        results = []
        for chat in self.db.get_chats():
            results.append(self.build_for_chat(chat["chat_id"]))
        return results

    def show_session(self, chat_id: int) -> dict[str, Any] | None:
        session = self.db.get_dialog_session(chat_id)
        if session is None:
            return None
        session["segments"] = self.db.get_dialog_segments(chat_id)
        session["summaries"] = self.db.get_dialog_summaries(chat_id)
        session["facts"] = self.db.get_dialog_facts(chat_id)
        session["compactions"] = self.db.get_dialog_compactions(chat_id)
        return session

    def get_segments(self, chat_id: int) -> list[dict[str, Any]]:
        return self.db.get_dialog_segments(chat_id)

    def get_facts(self, chat_id: int) -> list[dict[str, Any]]:
        facts = self.db.get_dialog_facts(chat_id)
        for fact in facts:
            fact["evidence"] = self.db.get_dialog_evidence(
                chat_id,
                owner_type="fact",
                owner_id=fact["fact_id"],
            )
        return facts

    def compact_chat(self, chat_id: int) -> dict[str, Any]:
        session = self.db.get_dialog_session(chat_id)
        if session is None:
            raise ValueError(f"Session for chat_id {chat_id} not built yet")
        compactions = self.db.get_dialog_compactions(chat_id)
        summaries = self.db.get_dialog_summaries(chat_id, kind="compacted")
        return {
            "session_id": session["session_id"],
            "chat_id": chat_id,
            "compactions": compactions,
            "summaries": summaries,
            "compacted": bool(compactions),
        }

    def reset_chat(self, chat_id: int) -> None:
        self.db.reset_dialog_session_state(chat_id)

    def ask_chat(self, chat_id: int, question: str) -> dict[str, Any]:
        projection = self.build_ask_projection(chat_id, question)
        prompt = self.render_ask_prompt(projection)
        backend_result = self.answer_backend.answer(projection, prompt)
        return {
            "chat_id": projection["chat_id"],
            "chat_name": projection["chat_name"],
            "session_id": projection["session_id"],
            "question": question,
            "projection": projection,
            "prompt": backend_result["prompt"],
            "backend": backend_result["backend"],
            "answer": backend_result["answer"],
            "quality": "heuristic-v2",
        }

    def build_ask_projection(self, chat_id: int, question: str) -> dict[str, Any]:
        session = self.show_session(chat_id)
        if session is None:
            raise ValueError(f"Session for chat_id {chat_id} not built yet")

        facts = self.get_facts(chat_id)
        segments = session.get("segments") or []
        summaries = session.get("summaries") or []
        compactions = session.get("compactions") or []
        all_messages = self.db.get_chat_messages(chat_id)
        active_assertions = self._collect_active_assertions(chat_id)
        historical_assertions = self._collect_historical_assertions(chat_id, question)
        tail_messages = all_messages[-8:]
        intent = classify_question(question)
        keywords = intent["keywords"]
        interaction_metrics = analyze_interaction_metrics(all_messages, subject_id=str(chat_id))
        interaction_patterns = analyze_interaction_patterns(all_messages, subject_id=str(chat_id))
        open_loops = detect_open_loops(all_messages, subject_id=f"telegram:user:{chat_id}")
        social_context = extract_social_context(all_messages, chat_id=chat_id)
        ontology_context = {
            "goals": [item for message in all_messages for item in extract_goals(message)],
            "constraints": [item for message in all_messages for item in extract_constraints(message)],
            "locations": [item for message in all_messages for item in extract_location_signals(message)],
            "projects": [item for message in all_messages for item in extract_occupation_or_project_signals(message)],
            "bond_components": extract_bond_components(all_messages),
        }
        profile_snapshot = self.db.get_subject_profile(f"telegram:user:{chat_id}")
        media_profile = {
            "items": self.db.list_message_media(chat_id=chat_id),
            "profile_music": self.db.list_subject_profile_music(f"telegram:user:{chat_id}"),
        }
        repost_profile = {
            "items": self.db.list_message_reposts(chat_id=chat_id),
            "profile_links": self.db.list_subject_profile_links(f"telegram:user:{chat_id}"),
        }

        relevant_facts = self._select_relevant_facts(facts, keywords, intent)
        relevant_segments = self._select_relevant_segments(segments, keywords, intent)
        relevant_evidence = self._collect_evidence(
            chat_id,
            relevant_facts,
            relevant_segments,
            tail_messages,
            needs_evidence=intent["needs_evidence"],
        )
        message_lookup = {message["msg_id"]: message for message in all_messages}
        evidence_snippets = []
        for item in relevant_evidence:
            msg = message_lookup.get(item["msg_id"])
            if not msg:
                continue
            evidence_snippets.append(
                {
                    "msg_id": msg["msg_id"],
                    "timestamp": msg["timestamp"],
                    "sender_name": msg.get("sender_name"),
                    "content": (msg.get("content") or "")[:240],
                    "note": item.get("note"),
                }
            )
        preserved_quotes = [
            {
                "msg_id": msg["msg_id"],
                "timestamp": msg["timestamp"],
                "sender_name": msg.get("sender_name"),
                "content": (msg.get("content") or "")[:280],
                "message_kind": msg.get("message_kind"),
            }
            for msg in self._salient_messages(all_messages, limit=5)
        ]
        structured_items = [
            {"kind": "fact", "source_id": fact.get("fact_id"), "msg_id": None, "score": float(fact.get("confidence", 0.5)), "freshness": 1.0}
            for fact in relevant_facts
        ] + [
            {"kind": "evidence", "source_id": item.get("owner_id"), "msg_id": item.get("msg_id"), "score": 0.9, "freshness": 1.0}
            for item in evidence_snippets
        ]
        semantic_items = semantic_search(self.db, chat_id=chat_id, query=question, top_k=5)
        retrieval_context = retrieve_context(structured_items=structured_items, semantic_items=semantic_items)
        return {
            "chat_id": chat_id,
            "chat_name": session.get("chat_name"),
            "session_id": session["session_id"],
            "question": question,
            "intent": intent,
            "query_keywords": keywords,
            "session_meta": {
                "dialog_type": session.get("dialog_type"),
                "message_count": session.get("message_count"),
                "segment_count": session.get("segment_count"),
                "first_msg_ts": session.get("first_msg_ts"),
                "last_msg_ts": session.get("last_msg_ts"),
                "last_built_at": session.get("last_built_at"),
            },
            "facts": relevant_facts,
            "segments": relevant_segments,
            "active_assertions": active_assertions,
            "historical_assertions": historical_assertions,
            "interaction_metrics": interaction_metrics,
            "interaction_patterns": interaction_patterns,
            "open_loops": open_loops,
            "social_context": social_context,
            "ontology_context": ontology_context,
            "profile_snapshot": profile_snapshot,
            "media_profile": media_profile,
            "repost_profile": repost_profile,
            "rolling_summary": next(
                (summary for summary in summaries if summary.get("kind") == "rolling"),
                None,
            ),
            "compacted_summary": next(
                (summary for summary in reversed(summaries) if summary.get("kind") == "compacted"),
                None,
            ),
            "recent_tail": [
                {
                    "msg_id": message["msg_id"],
                    "timestamp": message["timestamp"],
                    "sender_name": message.get("sender_name"),
                    "content": (message.get("content") or "")[:240],
                    "message_kind": message.get("message_kind"),
                }
                for message in tail_messages
            ],
            "preserved_quotes": preserved_quotes,
            "evidence": evidence_snippets,
            "semantic_hits": semantic_items,
            "retrieval": retrieval_context,
            "compactions": compactions,
        }

    def render_ask_prompt(self, projection: dict[str, Any]) -> str:
        lines = [
            f"You are answering a question about Telegram chat: {projection.get('chat_name')}",
            f"Question: {projection.get('question')}",
            "Use the provided projection as the only source of truth.",
            "Prefer grounded statements and mention uncertainty when evidence is weak.",
            "",
            "Session meta:",
            (
                f"- messages={projection['session_meta'].get('message_count')} "
                f"segments={projection['session_meta'].get('segment_count')} "
                f"type={projection['session_meta'].get('dialog_type')}"
            ),
        ]
        rolling = projection.get("rolling_summary")
        if rolling:
            lines.append(f"Rolling summary: {rolling.get('summary')}")
        compacted = projection.get("compacted_summary")
        if compacted:
            lines.append(f"Compacted summary: {compacted.get('summary')}")
        if projection.get("facts"):
            lines.append("Relevant facts:")
            for fact in projection["facts"][:5]:
                lines.append(
                    f"- {fact.get('predicate')}: {fact.get('object') or fact.get('value_json') or '—'}"
                )
        if projection.get("interaction_patterns"):
            lines.append("Interaction patterns:")
            for pattern in projection["interaction_patterns"][:4]:
                lines.append(f"- {pattern.get('pattern_type')}: {pattern.get('summary')}")
        if projection.get("segments"):
            lines.append("Relevant segments:")
            for segment in projection["segments"][:3]:
                lines.append(f"- segment {segment.get('seq')}: {segment.get('summary')}")
        if projection.get("preserved_quotes"):
            lines.append("Preserved quotes:")
            for quote in projection["preserved_quotes"][:4]:
                lines.append(
                    f"- msg {quote['msg_id']} [{quote['timestamp'][:19]}] {quote.get('sender_name') or 'Unknown'}: {quote['content']}"
                )
        if projection.get("evidence"):
            lines.append("Evidence snippets:")
            for evidence in projection["evidence"][:6]:
                lines.append(
                    f"- msg {evidence['msg_id']} [{evidence['timestamp'][:19]}] {evidence.get('sender_name') or 'Unknown'}: {evidence['content']}"
                )
        if projection.get("recent_tail"):
            lines.append("Recent tail:")
            for item in projection["recent_tail"][-4:]:
                lines.append(
                    f"- msg {item['msg_id']} [{item['timestamp'][:19]}] {item.get('sender_name') or 'Unknown'}: {item['content']}"
                )
        return "\n".join(lines)

    def _segment_messages(self, messages: list[dict[str, Any]]) -> list[_Segment]:
        segments: list[_Segment] = []
        current: list[dict[str, Any]] = []
        seq = 1
        last_ts: datetime | None = None

        for message in messages:
            ts = datetime.fromisoformat(message["timestamp"])
            should_split = False
            if current and last_ts is not None:
                prev = current[-1]
                delta_hours = (ts - last_ts).total_seconds() / 3600
                if delta_hours >= SEGMENT_GAP_HOURS:
                    should_split = True
                elif message.get("message_kind") == "service":
                    should_split = True
                elif (
                    delta_hours >= SEGMENT_SOFT_GAP_HOURS
                    and len(current) >= MIN_MESSAGES_PER_SEGMENT
                    and message.get("reply_to_msg_id") is None
                    and prev.get("reply_to_msg_id") is None
                ):
                    should_split = True
                elif (
                    len(current) >= MIN_MESSAGES_PER_SEGMENT
                    and message.get("sender_name")
                    and prev.get("sender_name")
                    and message.get("sender_name") != prev.get("sender_name")
                    and self._message_salience(message) >= 2
                    and self._message_salience(prev) >= 2
                ):
                    should_split = True
            if should_split:
                segments.append(_Segment(seq=seq, messages=current))
                seq += 1
                current = []
            current.append(message)
            last_ts = ts

        if current:
            segments.append(_Segment(seq=seq, messages=current))
        return segments

    def _build_artifacts(
        self,
        *,
        session_id: str,
        chat_id: int,
        chat_name: str,
        segments: list[_Segment],
        created_at: str,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        segment_rows: list[dict[str, Any]] = []
        summary_rows: list[dict[str, Any]] = []
        fact_rows: list[dict[str, Any]] = []
        evidence_rows: list[dict[str, Any]] = []

        all_senders: Counter[str] = Counter()
        all_kinds: Counter[str] = Counter()
        segment_keywords: list[str] = []
        open_loop_messages: list[dict[str, Any]] = []
        media_messages: list[dict[str, Any]] = []
        link_messages: list[dict[str, Any]] = []

        for segment in segments:
            sender_counter = Counter(
                m.get("sender_name") or "Unknown" for m in segment.messages if m.get("sender_name")
            )
            kind_counter = Counter(m.get("message_kind") or "message" for m in segment.messages)
            texts = [m.get("content") or "" for m in segment.messages if m.get("content")]
            keywords = top_keywords(texts)
            segment_keywords.extend(keywords)
            all_senders.update(sender_counter)
            all_kinds.update(kind_counter)
            dominant_sender = sender_counter.most_common(1)[0][0] if sender_counter else None
            topic_hint = self._topic_hint(kind_counter, sender_counter, keywords)
            summary = self._summarize_segment(chat_name, segment, dominant_sender, kind_counter, keywords)
            segment_id = f"{session_id}:segment:{segment.seq}"
            summary_id = f"{session_id}:summary:segment:{segment.seq}"
            segment_rows.append(
                {
                    "segment_id": segment_id,
                    "session_id": session_id,
                    "seq": segment.seq,
                    "start_msg_id": segment.start["msg_id"],
                    "end_msg_id": segment.end["msg_id"],
                    "start_ts": segment.start["timestamp"],
                    "end_ts": segment.end["timestamp"],
                    "message_count": len(segment.messages),
                    "dominant_sender": dominant_sender,
                    "topic_hint": topic_hint,
                    "summary": summary,
                    "status": "active",
                }
            )
            summary_rows.append(
                {
                    "summary_id": summary_id,
                    "session_id": session_id,
                    "segment_id": segment_id,
                    "kind": "segment",
                    "summary": summary,
                    "payload_json": {
                        "start_msg_id": segment.start["msg_id"],
                        "end_msg_id": segment.end["msg_id"],
                        "message_count": len(segment.messages),
                        "dominant_sender": dominant_sender,
                        "keywords": keywords,
                    },
                    "created_at": created_at,
                }
            )
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="summary",
                    owner_id=summary_id,
                    messages=self._salient_messages(segment.messages),
                    note="segment-summary",
                )
            )
            open_loop_messages.extend(
                msg for msg in segment.messages if looks_like_open_loop(msg.get("content") or "")
            )
            media_messages.extend(msg for msg in segment.messages if msg.get("has_media"))
            link_messages.extend(msg for msg in segment.messages if contains_link(msg.get("content") or ""))

        rolling_summary_id = f"{session_id}:summary:rolling"
        rolling_keywords = top_keywords(segment_keywords)
        rolling_summary = self._rolling_summary(chat_name, segments, rolling_keywords)
        summary_rows.append(
            {
                "summary_id": rolling_summary_id,
                "session_id": session_id,
                "segment_id": None,
                "kind": "rolling",
                "summary": rolling_summary,
                "payload_json": {
                    "segment_count": len(segments),
                    "chat_name": chat_name,
                    "keywords": rolling_keywords,
                },
                "created_at": created_at,
            }
        )
        evidence_rows.extend(
            self._evidence_for_owner(
                session_id=session_id,
                chat_id=chat_id,
                owner_type="summary",
                owner_id=rolling_summary_id,
                messages=self._salient_messages([message for segment in segments for message in segment.messages]),
                note="rolling-summary",
            )
        )

        if all_senders:
            top_sender, count = all_senders.most_common(1)[0]
            fact_id = f"{session_id}:fact:top-sender"
            fact_rows.append(
                {
                    "fact_id": fact_id,
                    "session_id": session_id,
                    "fact_type": "activity",
                    "subject": chat_name,
                    "predicate": "top_sender",
                    "object": top_sender,
                    "value_json": {"message_count": count},
                    "confidence": 0.95,
                    "status": "active",
                    "created_at": created_at,
                }
            )
            top_sender_messages = [
                m for segment in segments for m in segment.messages if (m.get("sender_name") or "") == top_sender
            ]
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="fact",
                    owner_id=fact_id,
                    messages=self._salient_messages(top_sender_messages),
                    note="top-sender",
                )
            )

        if all_kinds:
            top_kind, count = all_kinds.most_common(1)[0]
            fact_id = f"{session_id}:fact:top-kind"
            fact_rows.append(
                {
                    "fact_id": fact_id,
                    "session_id": session_id,
                    "fact_type": "message-kind",
                    "subject": chat_name,
                    "predicate": "dominant_kind",
                    "object": top_kind,
                    "value_json": {"message_count": count},
                    "confidence": 0.9,
                    "status": "active",
                    "created_at": created_at,
                }
            )
            top_kind_messages = [
                m for segment in segments for m in segment.messages if (m.get("message_kind") or "message") == top_kind
            ]
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="fact",
                    owner_id=fact_id,
                    messages=self._salient_messages(top_kind_messages),
                    note="dominant-kind",
                )
            )

        replied_messages = [m for segment in segments for m in segment.messages if m.get("reply_to_msg_id")]
        if replied_messages:
            fact_id = f"{session_id}:fact:reply-activity"
            fact_rows.append(
                {
                    "fact_id": fact_id,
                    "session_id": session_id,
                    "fact_type": "threading",
                    "subject": chat_name,
                    "predicate": "has_reply_activity",
                    "object": "true",
                    "value_json": {"reply_count": len(replied_messages)},
                    "confidence": 0.85,
                    "status": "active",
                    "created_at": created_at,
                }
            )
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="fact",
                    owner_id=fact_id,
                    messages=self._salient_messages(replied_messages),
                    note="reply-activity",
                )
            )

        if media_messages:
            fact_id = f"{session_id}:fact:media-presence"
            fact_rows.append(
                {
                    "fact_id": fact_id,
                    "session_id": session_id,
                    "fact_type": "media",
                    "subject": chat_name,
                    "predicate": "has_media_flow",
                    "object": "true",
                    "value_json": {"media_messages": len(media_messages)},
                    "confidence": 0.8,
                    "status": "active",
                    "created_at": created_at,
                }
            )
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="fact",
                    owner_id=fact_id,
                    messages=self._salient_messages(media_messages),
                    note="media-flow",
                )
            )

        if link_messages:
            fact_id = f"{session_id}:fact:link-sharing"
            fact_rows.append(
                {
                    "fact_id": fact_id,
                    "session_id": session_id,
                    "fact_type": "links",
                    "subject": chat_name,
                    "predicate": "shares_links",
                    "object": "true",
                    "value_json": {"link_messages": len(link_messages)},
                    "confidence": 0.75,
                    "status": "active",
                    "created_at": created_at,
                }
            )
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="fact",
                    owner_id=fact_id,
                    messages=self._salient_messages(link_messages),
                    note="link-sharing",
                )
            )

        if open_loop_messages:
            fact_id = f"{session_id}:fact:open-loops"
            fact_rows.append(
                {
                    "fact_id": fact_id,
                    "session_id": session_id,
                    "fact_type": "open-loop",
                    "subject": chat_name,
                    "predicate": "has_follow_up_candidates",
                    "object": "true",
                    "value_json": {"count": len(open_loop_messages)},
                    "confidence": 0.7,
                    "status": "active",
                    "created_at": created_at,
                }
            )
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="fact",
                    owner_id=fact_id,
                    messages=self._salient_messages(open_loop_messages),
                    note="open-loops",
                )
            )

        if rolling_keywords:
            fact_id = f"{session_id}:fact:keywords"
            fact_rows.append(
                {
                    "fact_id": fact_id,
                    "session_id": session_id,
                    "fact_type": "keywords",
                    "subject": chat_name,
                    "predicate": "top_keywords",
                    "object": ", ".join(rolling_keywords),
                    "value_json": {"keywords": rolling_keywords},
                    "confidence": 0.65,
                    "status": "active",
                    "created_at": created_at,
                }
            )
            evidence_rows.extend(
                self._evidence_for_owner(
                    session_id=session_id,
                    chat_id=chat_id,
                    owner_type="fact",
                    owner_id=fact_id,
                    messages=self._salient_messages([message for segment in segments for message in segment.messages]),
                    note="top-keywords",
                )
            )

        return segment_rows, summary_rows, fact_rows, evidence_rows

    def _build_compaction(
        self,
        *,
        session_id: str,
        chat_id: int,
        summary_rows: list[dict[str, Any]],
        evidence_rows: list[dict[str, Any]],
        segments: list[_Segment],
        created_at: str,
    ) -> tuple[bool, dict[str, Any] | None]:
        if len(segments) < COMPACTION_MIN_SEGMENTS:
            return False, None

        preserved = segments[-COMPACTION_PRESERVED_TAIL :]
        preserved_set = {segment.seq for segment in preserved}
        salient_middle = [segment for segment in segments[:-COMPACTION_PRESERVED_TAIL] if self._segment_salience(segment) >= 3]
        salient_middle = salient_middle[-COMPACTION_EXTRA_SALIENCE_SEGMENTS:]
        preserved_set.update(segment.seq for segment in salient_middle)
        compacted_segments = [segment for segment in segments if segment.seq not in preserved_set]
        if not compacted_segments:
            return False, None

        preserved_count = len([segment for segment in segments if segment.seq in preserved_set])
        compacted_summary_id = f"{session_id}:summary:compacted"
        compacted_keywords = top_keywords(
            [msg.get("content") or "" for segment in compacted_segments for msg in segment.messages]
        )
        compacted_summary = (
            f"Compacted {len(compacted_segments)} older segments covering messages "
            f"{compacted_segments[0].start['msg_id']}–{compacted_segments[-1].end['msg_id']}. "
            f"Preserved {preserved_count} higher-salience recent segments."
        )
        summary_rows.append(
            {
                "summary_id": compacted_summary_id,
                "session_id": session_id,
                "segment_id": None,
                "kind": "compacted",
                "summary": compacted_summary,
                "payload_json": {
                    "segment_count": len(compacted_segments),
                    "covered_until_msg_id": compacted_segments[-1].end["msg_id"],
                    "keywords": compacted_keywords,
                    "preserved_segments": sorted(preserved_set),
                },
                "created_at": created_at,
            }
        )
        evidence_rows.extend(
            self._evidence_for_owner(
                session_id=session_id,
                chat_id=chat_id,
                owner_type="summary",
                owner_id=compacted_summary_id,
                messages=self._salient_messages([msg for segment in compacted_segments for msg in segment.messages]),
                note="compacted-summary",
            )
        )
        return True, {
            "compaction_id": f"{session_id}:compaction:{uuid4().hex[:8]}",
            "session_id": session_id,
            "chat_id": chat_id,
            "summary_id": compacted_summary_id,
            "covered_until_msg_id": compacted_segments[-1].end["msg_id"],
            "preserved_tail_count": preserved_count,
            "policy_json": {
                "min_segments": COMPACTION_MIN_SEGMENTS,
                "preserved_tail": COMPACTION_PRESERVED_TAIL,
                "extra_salience_segments": COMPACTION_EXTRA_SALIENCE_SEGMENTS,
                "preserved_segments": sorted(preserved_set),
            },
            "created_at": created_at,
        }

    def _topic_hint(
        self,
        kind_counter: Counter[str],
        sender_counter: Counter[str],
        keywords: list[str],
    ) -> str:
        top_kind = kind_counter.most_common(1)[0][0] if kind_counter else "message"
        top_sender = sender_counter.most_common(1)[0][0] if sender_counter else "Unknown"
        if keywords:
            return f"{top_kind}:{', '.join(keywords[:2])}"
        if top_kind != "message":
            return f"{top_kind}-heavy"
        return f"conversation-led-by-{top_sender}"

    def _summarize_segment(
        self,
        chat_name: str,
        segment: _Segment,
        dominant_sender: str | None,
        kind_counter: Counter[str],
        keywords: list[str],
    ) -> str:
        preview = preview_texts([msg.get("content") or "" for msg in segment.messages])
        top_kind = kind_counter.most_common(1)[0][0] if kind_counter else "message"
        keyword_part = f" Keywords: {', '.join(keywords[:3])}." if keywords else ""
        return (
            f"Segment {segment.seq} in {chat_name}: {len(segment.messages)} messages from "
            f"{segment.start['timestamp'][:19]} to {segment.end['timestamp'][:19]}, "
            f"dominant sender {dominant_sender or 'Unknown'}, dominant kind {top_kind}."
            f"{keyword_part} Preview: {preview}"
        )

    def _rolling_summary(self, chat_name: str, segments: list[_Segment], keywords: list[str]) -> str:
        start = segments[0].start["timestamp"][:19]
        end = segments[-1].end["timestamp"][:19]
        total_messages = sum(len(seg.messages) for seg in segments)
        keyword_part = f" Top keywords: {', '.join(keywords[:4])}." if keywords else ""
        return (
            f"Dialog session for {chat_name}: {total_messages} messages across {len(segments)} segments "
            f"from {start} to {end}.{keyword_part}"
        )

    def _infer_dialog_type(self, messages: list[dict[str, Any]]) -> str:
        kinds = {m.get("message_kind") for m in messages if m.get("message_kind")}
        if "service" in kinds and any(m.get("reply_to_msg_id") for m in messages):
            return "threaded"
        if any(m.get("has_media") for m in messages):
            return "media-rich"
        if any(contains_link(m.get("content") or "") for m in messages):
            return "link-sharing"
        return "chat"

    def _segment_salience(self, segment: _Segment) -> int:
        score = 0
        messages = segment.messages
        if any(msg.get("has_media") for msg in messages):
            score += 2
        if any(msg.get("reply_to_msg_id") for msg in messages):
            score += 2
        if any(contains_link(msg.get("content") or "") for msg in messages):
            score += 1
        if any(looks_like_open_loop(msg.get("content") or "") for msg in messages):
            score += 2
        if any((msg.get("message_kind") or "message") == "service" for msg in messages):
            score += 1
        if len(top_keywords([msg.get("content") or "" for msg in messages], limit=2)) >= 2:
            score += 1
        return score

    def _message_salience(self, message: dict[str, Any]) -> int:
        score = 0
        text = message.get("content") or ""
        if message.get("has_media"):
            score += 2
        if message.get("reply_to_msg_id"):
            score += 2
        if contains_link(text):
            score += 1
        if looks_like_open_loop(text):
            score += 2
        if (message.get("message_kind") or "message") == "service":
            score += 1
        if len(text.strip()) > 120:
            score += 1
        return score

    def _salient_messages(self, messages: list[dict[str, Any]], *, limit: int = 5) -> list[dict[str, Any]]:
        ranked = sorted(messages, key=self._message_salience, reverse=True)
        result: list[dict[str, Any]] = []
        seen: set[int] = set()
        for message in ranked:
            msg_id = message["msg_id"]
            if msg_id in seen:
                continue
            seen.add(msg_id)
            result.append(message)
            if len(result) >= limit:
                break
        if result:
            return result
        return messages[:limit]

    def _collect_active_assertions(self, chat_id: int) -> list[dict[str, Any]]:
        observations = self.db.list_subject_observations(chat_id=chat_id)
        subject_ids = sorted({item["subject_id"] for item in observations})
        if not subject_ids:
            rows = self.db.conn.execute(
                "SELECT DISTINCT subject_id FROM subject_assertions WHERE chat_id = ? ORDER BY subject_id ASC",
                (chat_id,),
            ).fetchall()
            subject_ids = [row[0] for row in rows]
        assertions = []
        for subject_id in subject_ids:
            for field in ("work", "city", "study", "project", "hobby"):
                current = resolve_field_current(self.db, subject_id, field)
                if current is not None:
                    current["evidence"] = self.db.list_assertion_evidence(current["assertion_id"])
                    assertions.append(current)
        return assertions

    def _collect_historical_assertions(self, chat_id: int, question: str) -> list[dict[str, Any]]:
        lowered = question.lower()
        if not any(marker in lowered for marker in ("раньше", "before", "past", "работала", "работал")):
            return []
        observations = self.db.list_subject_observations(chat_id=chat_id)
        subject_ids = sorted({item["subject_id"] for item in observations})
        if not subject_ids:
            rows = self.db.conn.execute(
                "SELECT DISTINCT subject_id FROM subject_assertions WHERE chat_id = ? ORDER BY subject_id ASC",
                (chat_id,),
            ).fetchall()
            subject_ids = [row[0] for row in rows]
        historical = []
        for subject_id in subject_ids:
            for field in ("work", "city", "study", "project"):
                rows = self.db.conn.execute(
                    "SELECT * FROM subject_assertions WHERE subject_id = ? AND field = ? ORDER BY first_seen_at ASC",
                    (subject_id, field),
                ).fetchall()
                if rows:
                    item = dict(rows[0])
                    item["evidence"] = self.db.list_assertion_evidence(item["assertion_id"])
                    historical.append(item)
        return historical

    def _select_relevant_facts(
        self,
        facts: list[dict[str, Any]],
        keywords: list[str],
        intent: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if intent.get("prefers_people_memory"):
            people_first = [
                fact
                for fact in facts
                if fact.get("predicate") in {"top_sender", "top_keywords"}
            ]
            if people_first:
                return people_first[:5]
        if not keywords:
            return facts[:5]
        scored = []
        for fact in facts:
            haystack = " ".join(
                str(part)
                for part in [
                    fact.get("fact_type"),
                    fact.get("predicate"),
                    fact.get("object"),
                    fact.get("subject"),
                ]
                if part
            ).lower()
            score = sum(1 for keyword in keywords if keyword in haystack)
            scored.append((score, fact.get("confidence", 0), fact))
        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        selected = [fact for score, _, fact in scored if score > 0][:5]
        return selected or facts[:5]

    def _select_relevant_segments(
        self,
        segments: list[dict[str, Any]],
        keywords: list[str],
        intent: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if not segments:
            return []
        if intent.get("prefers_summary"):
            return segments[-5:]
        if not keywords:
            return segments[-3:]
        scored = []
        for segment in segments:
            haystack = " ".join(
                str(part)
                for part in [segment.get("topic_hint"), segment.get("summary")]
                if part
            ).lower()
            score = sum(1 for keyword in keywords if keyword in haystack)
            scored.append((score, segment.get("seq", 0), segment))
        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        selected = [segment for score, _, segment in scored if score > 0][:3]
        return selected or segments[-3:]

    def _collect_evidence(
        self,
        chat_id: int,
        facts: list[dict[str, Any]],
        segments: list[dict[str, Any]],
        tail_messages: list[dict[str, Any]],
        *,
        needs_evidence: bool,
    ) -> list[dict[str, Any]]:
        evidence: list[dict[str, Any]] = []
        seen: set[tuple[str, int]] = set()
        if not needs_evidence:
            tail_messages = self._salient_messages(tail_messages, limit=2)
        for fact in facts:
            for item in self.db.get_dialog_evidence(
                chat_id,
                owner_type="fact",
                owner_id=fact["fact_id"],
            ):
                key = ("fact", item["msg_id"])
                if key not in seen:
                    seen.add(key)
                    evidence.append(item)
        for segment in segments:
            owner_id = f"telegram:{chat_id}:summary:segment:{segment['seq']}"
            for item in self.db.get_dialog_evidence(
                chat_id,
                owner_type="summary",
                owner_id=owner_id,
            ):
                key = ("summary", item["msg_id"])
                if key not in seen:
                    seen.add(key)
                    evidence.append(item)
        for message in self._salient_messages(tail_messages, limit=3):
            key = ("tail", message["msg_id"])
            if key not in seen:
                seen.add(key)
                evidence.append(
                    {
                        "owner_type": "tail",
                        "owner_id": "recent-tail",
                        "msg_id": message["msg_id"],
                        "note": "recent-tail",
                    }
                )
        return evidence[:10]

    def _evidence_for_owner(
        self,
        *,
        session_id: str,
        chat_id: int,
        owner_type: str,
        owner_id: str,
        messages: list[dict[str, Any]],
        note: str,
    ) -> list[dict[str, Any]]:
        unique: list[int] = []
        for msg in messages:
            msg_id = msg["msg_id"]
            if msg_id not in unique:
                unique.append(msg_id)
        return [
            {
                "session_id": session_id,
                "chat_id": chat_id,
                "owner_type": owner_type,
                "owner_id": owner_id,
                "msg_id": msg_id,
                "note": note,
            }
            for msg_id in unique[:5]
        ]
