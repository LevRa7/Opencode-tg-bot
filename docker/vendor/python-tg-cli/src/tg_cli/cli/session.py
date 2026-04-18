"""Session-oriented commands for derived dialog analysis."""

from __future__ import annotations

import click
from rich.table import Table

from ..ask_backends import get_answer_backend
from ..console import console
from ..db import MessageDB
from ..interaction_analyzer import analyze_interaction_metrics, analyze_interaction_patterns
from ..session_engine import DialogSessionEngine
from ._chat import resolve_chat_id_or_print
from ._output import emit_structured, structured_output_options


@click.group("session")
def session_group():
    """Dialog session analysis commands."""


@session_group.command("session-build")
@click.argument("chat")
@structured_output_options
def session_build(chat: str, as_json: bool, as_yaml: bool):
    """Build or refresh derived session state for one chat."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        result = DialogSessionEngine(db).build_for_chat(chat_id)
    payload = {
        "chat_id": result.chat_id,
        "chat_name": result.chat_name,
        "session_id": result.session_id,
        "message_count": result.message_count,
        "segment_count": result.segment_count,
        "fact_count": result.fact_count,
        "summary_count": result.summary_count,
        "compacted": result.compacted,
        "quality": "heuristic-v2",
    }
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(
        f"[green]✓[/green] Built session for [bold]{result.chat_name}[/bold]: "
        f"{result.segment_count} segments, {result.fact_count} facts"
    )


@session_group.command("session-build-all")
@structured_output_options
def session_build_all(as_json: bool, as_yaml: bool):
    """Build or refresh derived session state for all chats."""
    with MessageDB() as db:
        results = DialogSessionEngine(db).build_all()
    payload = {
        "sessions": [
            {
                "chat_id": result.chat_id,
                "chat_name": result.chat_name,
                "session_id": result.session_id,
                "message_count": result.message_count,
                "segment_count": result.segment_count,
                "fact_count": result.fact_count,
                "summary_count": result.summary_count,
                "compacted": result.compacted,
            }
            for result in results
        ],
        "count": len(results),
    }
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"[green]✓[/green] Built {len(results)} dialog sessions")


@session_group.command("session-show")
@click.argument("chat")
@structured_output_options
def session_show(chat: str, as_json: bool, as_yaml: bool):
    """Show high-level derived session state for one chat."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        data = DialogSessionEngine(db).show_session(chat_id)
        if data is None:
            if emit_structured(
                {
                    "ok": False,
                    "schema_version": "1",
                    "error": {
                        "code": "session_not_built",
                        "message": f"Session for '{chat}' has not been built yet.",
                    },
                },
                as_json=as_json,
                as_yaml=as_yaml,
            ):
                raise SystemExit(1) from None
            console.print(f"[red]Session for '{chat}' has not been built yet.[/red]")
            return
    if emit_structured(data, as_json=as_json, as_yaml=as_yaml):
        return
    table = Table(title=f"Session: {data.get('chat_name') or chat}")
    table.add_column("Field", style="bold")
    table.add_column("Value")
    table.add_row("Session ID", data["session_id"])
    table.add_row("Dialog type", data.get("dialog_type") or "—")
    table.add_row("Messages", str(data.get("message_count") or 0))
    table.add_row("Segments", str(data.get("segment_count") or 0))
    table.add_row("First", str(data.get("first_msg_ts") or "—")[:19])
    table.add_row("Last", str(data.get("last_msg_ts") or "—")[:19])
    table.add_row("Last built", str(data.get("last_built_at") or "—")[:19])
    table.add_row("Facts", str(len(data.get("facts") or [])))
    table.add_row("Compactions", str(len(data.get("compactions") or [])))
    console.print(table)
    summaries = data.get("summaries") or []
    if summaries:
        console.print(f"\n[bold]Latest summary:[/bold] {summaries[-1]['summary']}")


@session_group.command("session-segments")
@click.argument("chat")
@structured_output_options
def session_segments(chat: str, as_json: bool, as_yaml: bool):
    """List derived segments for one chat."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        segments = DialogSessionEngine(db).get_segments(chat_id)
    if emit_structured(segments, as_json=as_json, as_yaml=as_yaml):
        return
    if not segments:
        console.print("[yellow]No derived segments found.[/yellow]")
        return
    table = Table(title=f"Segments: {chat}")
    table.add_column("#", justify="right")
    table.add_column("Range")
    table.add_column("Msgs", justify="right")
    table.add_column("Sender")
    table.add_column("Hint")
    for segment in segments:
        table.add_row(
            str(segment["seq"]),
            f"{segment['start_msg_id']}–{segment['end_msg_id']}",
            str(segment["message_count"]),
            segment.get("dominant_sender") or "—",
            segment.get("topic_hint") or "—",
        )
    console.print(table)


@session_group.command("session-facts")
@click.argument("chat")
@structured_output_options
def session_facts(chat: str, as_json: bool, as_yaml: bool):
    """List derived durable facts for one chat."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        facts = DialogSessionEngine(db).get_facts(chat_id)
    if emit_structured(facts, as_json=as_json, as_yaml=as_yaml):
        return
    if not facts:
        console.print("[yellow]No derived facts found.[/yellow]")
        return
    table = Table(title=f"Facts: {chat}")
    table.add_column("Type")
    table.add_column("Predicate")
    table.add_column("Object")
    table.add_column("Conf", justify="right")
    table.add_column("Evidence")
    for fact in facts:
        evidence = ", ".join(str(item["msg_id"]) for item in fact.get("evidence", [])) or "—"
        table.add_row(
            fact.get("fact_type") or "—",
            fact.get("predicate") or "—",
            fact.get("object") or "—",
            f"{fact.get('confidence', 0):.2f}",
            evidence,
        )
    console.print(table)


@session_group.command("session-compact")
@click.argument("chat")
@structured_output_options
def session_compact(chat: str, as_json: bool, as_yaml: bool):
    """Show compaction state for one chat."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        data = DialogSessionEngine(db).compact_chat(chat_id)
    if emit_structured(data, as_json=as_json, as_yaml=as_yaml):
        return
    if not data.get("compacted"):
        console.print("[yellow]No compaction artifacts yet.[/yellow]")
        return
    console.print(
        f"[green]Compacted[/green] chat {chat}: {len(data.get('compactions', []))} compaction record(s)"
    )
    summaries = data.get("summaries") or []
    if summaries:
        console.print(f"[bold]Latest compacted summary:[/bold] {summaries[-1]['summary']}")


@session_group.command("ask")
@click.argument("chat")
@click.argument("question")
@click.option(
    "--backend",
    type=click.Choice(["local-synthesizer", "claude", "opencode"]),
    default="local-synthesizer",
    show_default=True,
    help="Answer backend for synthesis step.",
)
@structured_output_options
def session_ask(chat: str, question: str, backend: str, as_json: bool, as_yaml: bool):
    """Answer a question about a chat using the derived session layer."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        engine = DialogSessionEngine(db, answer_backend=get_answer_backend(backend))
        if engine.show_session(chat_id) is None:
            engine.build_for_chat(chat_id)
        data = engine.ask_chat(chat_id, question)
    if emit_structured(data, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"[bold]Question:[/bold] {question}")
    console.print(f"\n{data['answer']}")


@session_group.command("projection")
@click.argument("chat")
@click.argument("question")
@structured_output_options
def session_projection(chat: str, question: str, as_json: bool, as_yaml: bool):
    """Inspect the ask projection without running answer synthesis."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        engine = DialogSessionEngine(db)
        if engine.show_session(chat_id) is None:
            engine.build_for_chat(chat_id)
        data = engine.build_ask_projection(chat_id, question)
    if emit_structured(data, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(data)


@session_group.command("subject-show")
@click.argument("chat")
@structured_output_options
def session_subject_show(chat: str, as_json: bool, as_yaml: bool):
    """Show current subject assertions for the chat subject."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        engine = DialogSessionEngine(db)
        data = {
            "chat_id": chat_id,
            "subject_id": f"telegram:user:{chat_id}",
            "active_assertions": engine._collect_active_assertions(chat_id),
        }
    if emit_structured(data, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(data)


@session_group.command("events")
@click.argument("chat")
@structured_output_options
def session_events(chat: str, as_json: bool, as_yaml: bool):
    """Show recorded message events for the chat."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        data = db.list_message_events(chat_id)
    if emit_structured(data, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(data)


@session_group.command("interaction-metrics")
@click.argument("chat")
@structured_output_options
def session_interaction_metrics(chat: str, as_json: bool, as_yaml: bool):
    """Inspect derived interaction metrics and patterns for a chat."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        messages = db.get_chat_messages(chat_id)
        data = {
            "chat_id": chat_id,
            "metrics": analyze_interaction_metrics(messages, subject_id=str(chat_id)),
            "patterns": analyze_interaction_patterns(messages, subject_id=str(chat_id)),
        }
    if emit_structured(data, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(data)


@session_group.command("session-reset")
@click.argument("chat")
@click.option("-y", "--yes", is_flag=True, help="Skip confirmation")
@structured_output_options
def session_reset(chat: str, yes: bool, as_json: bool, as_yaml: bool):
    """Delete derived session state for one chat while preserving raw messages."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return
        if not yes and not click.confirm(f"Reset derived session state for {chat}?"):
            return
        DialogSessionEngine(db).reset_chat(chat_id)
    payload = {"reset": True, "chat": chat}
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"[green]✓[/green] Reset derived session state for {chat}")
