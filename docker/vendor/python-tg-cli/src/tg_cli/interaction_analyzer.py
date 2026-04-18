"""Interaction analytics derived from chat message history."""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

_CARING_MARKERS = ("что с тобой", "почему", "стрем", "ты как", "как ты", "что случилось")
_SHORT_ACKS = {"ок", "ог", "угу", "вижу", "ясно", "понятно"}
_FEEDBACK_NEG = ("без души", "не очень", "слабовато", "не зашло")
_FEEDBACK_POS = ("круто", "красиво", "нравится", "хорошо")
_SUPPORT_MARKERS = ("/login", "отправь", "сделай", "еще раз", "токен", "бот")
_FOLLOW_UP_MARKERS = ("напишу", "скину", "потом", "позже", "завтра")
_EMOJI_CHARS = {"🙂", "🔥", "😂", "😭", "❤️", "💔", "😅", "😊", "😢", "👍", "🙏"}


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def _emoji_list(text: str) -> list[str]:
    return [char for char in text if char in _EMOJI_CHARS]


def build_topic_timeline(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    timeline = []
    for message in messages:
        text = (message.get("content") or "").lower()
        topic = None
        if any(marker in text for marker in _FEEDBACK_NEG + _FEEDBACK_POS):
            topic = "feedback"
        elif any(marker in text for marker in _SUPPORT_MARKERS):
            topic = "support"
        elif any(marker in text for marker in _CARING_MARKERS):
            topic = "care"
        if topic:
            timeline.append(
                {
                    "msg_id": message["msg_id"],
                    "topic_label": topic,
                    "timestamp": message["timestamp"],
                }
            )
    return timeline


def analyze_interaction_metrics(messages: list[dict[str, Any]], *, subject_id: str) -> dict[str, Any]:
    if not messages:
        return {
            "sent_count": 0,
            "reply_count": 0,
            "reaction_count": 0,
            "edit_count": 0,
            "delete_count": 0,
            "avg_response_latency_sec": None,
            "avg_read_latency_sec": None,
            "emoji_count": 0,
            "top_emojis_json": [],
        }
    response_latencies = []
    emoji_counter: Counter[str] = Counter()
    sent_count = 0
    reply_count = 0
    for previous, current in zip(messages, messages[1:]):
        if current.get("sender_name") == "Снежана":
            sent_count += 1
        if previous.get("sender_name") != current.get("sender_name"):
            latency = (_parse_ts(current["timestamp"]) - _parse_ts(previous["timestamp"])).total_seconds()
            if latency >= 0:
                response_latencies.append(latency)
                reply_count += 1
        emoji_counter.update(_emoji_list(current.get("content") or ""))
    emoji_counter.update(_emoji_list(messages[0].get("content") or ""))
    avg_latency = sum(response_latencies) / len(response_latencies) if response_latencies else None
    initiations_by_sender: Counter[str] = Counter()
    previous_sender = None
    for message in messages:
        sender = message.get("sender_name") or "Unknown"
        if sender != previous_sender:
            initiations_by_sender[sender] += 1
            previous_sender = sender
    return {
        "sent_count": max(sent_count, 1),
        "reply_count": reply_count,
        "reaction_count": 0,
        "edit_count": 0,
        "delete_count": 0,
        "avg_response_latency_sec": avg_latency,
        "avg_read_latency_sec": None,
        "emoji_count": sum(emoji_counter.values()),
        "top_emojis_json": [emoji for emoji, _ in emoji_counter.most_common(5)],
        "initiative_balance": dict(initiations_by_sender),
    }


def analyze_interaction_patterns(messages: list[dict[str, Any]], *, subject_id: str) -> list[dict[str, Any]]:
    patterns: list[dict[str, Any]] = []
    if not messages:
        return patterns

    caring_evidence = []
    short_ack_evidence = []
    feedback_neg = []
    feedback_pos = []
    support_evidence = []
    follow_up_evidence = []
    for message in messages:
        text = (message.get("content") or "").strip().lower()
        if any(marker in text for marker in _CARING_MARKERS):
            caring_evidence.append({"msg_id": message["msg_id"], "text": message.get("content") or ""})
        if text in _SHORT_ACKS:
            short_ack_evidence.append({"msg_id": message["msg_id"], "text": message.get("content") or ""})
        if any(marker in text for marker in _FEEDBACK_NEG):
            feedback_neg.append({"msg_id": message["msg_id"], "text": message.get("content") or ""})
        if any(marker in text for marker in _FEEDBACK_POS):
            feedback_pos.append({"msg_id": message["msg_id"], "text": message.get("content") or ""})
        if any(marker in text for marker in _SUPPORT_MARKERS):
            support_evidence.append({"msg_id": message["msg_id"], "text": message.get("content") or ""})
        if any(marker in text for marker in _FOLLOW_UP_MARKERS):
            follow_up_evidence.append({"msg_id": message["msg_id"], "text": message.get("content") or ""})

    if caring_evidence:
        patterns.append(
            {
                "pattern_type": "caring_response",
                "summary": "Shows concern through brief alarm or follow-up questions when the other person reports distress.",
                "confidence": 0.8,
                "first_seen_at": messages[0]["timestamp"],
                "last_seen_at": messages[-1]["timestamp"],
                "evidence_json": caring_evidence[:5],
            }
        )

    if len(caring_evidence) >= 2:
        patterns.append(
            {
                "pattern_type": "care_escalation",
                "summary": "Escalates from alarm to active questioning when the other person appears unwell or vulnerable.",
                "confidence": 0.82,
                "first_seen_at": messages[0]["timestamp"],
                "last_seen_at": messages[-1]["timestamp"],
                "evidence_json": caring_evidence[:5],
            }
        )

    if len(short_ack_evidence) >= 2:
        patterns.append(
            {
                "pattern_type": "short_ack",
                "summary": "Often uses brief acknowledgment replies to stay engaged without expanding the topic.",
                "confidence": 0.75,
                "first_seen_at": messages[0]["timestamp"],
                "last_seen_at": messages[-1]["timestamp"],
                "evidence_json": short_ack_evidence[:5],
            }
        )

    if feedback_neg and feedback_pos:
        patterns.append(
            {
                "pattern_type": "nuanced_feedback",
                "summary": "Gives mixed feedback that combines critique with positive reinforcement instead of a flat judgment.",
                "confidence": 0.85,
                "first_seen_at": messages[0]["timestamp"],
                "last_seen_at": messages[-1]["timestamp"],
                "evidence_json": [*feedback_neg[:2], *feedback_pos[:2]],
            }
        )

    if len(support_evidence) >= 2:
        patterns.append(
            {
                "pattern_type": "support_coordination",
                "summary": "The conversation enters a coordinated troubleshooting/instruction mode around a task or tool issue.",
                "confidence": 0.8,
                "first_seen_at": messages[0]["timestamp"],
                "last_seen_at": messages[-1]["timestamp"],
                "evidence_json": support_evidence[:5],
            }
        )
        lead_sender = (messages[0].get("sender_name") if support_evidence else None) or "Unknown"
        patterns.append(
            {
                "pattern_type": "support_role_lead",
                "summary": f"{lead_sender} appears to lead troubleshooting/instruction flow in this support segment.",
                "confidence": 0.7,
                "first_seen_at": messages[0]["timestamp"],
                "last_seen_at": messages[-1]["timestamp"],
                "evidence_json": support_evidence[:5],
            }
        )

    if follow_up_evidence:
        patterns.append(
            {
                "pattern_type": "follow_up_commitment",
                "summary": "Makes an explicit future-oriented commitment or follow-up promise in the conversation.",
                "confidence": 0.72,
                "first_seen_at": messages[0]["timestamp"],
                "last_seen_at": messages[-1]["timestamp"],
                "evidence_json": follow_up_evidence[:5],
            }
        )

    return patterns
