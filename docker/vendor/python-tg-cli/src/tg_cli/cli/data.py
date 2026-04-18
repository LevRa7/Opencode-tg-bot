"""Data commands — export, purge."""

import click

from ..console import console
from ..db import MessageDB
from ..export_filters import filter_export_messages, parse_size_limit
from ..export_scopes import select_scope_chat_ids
from ._chat import resolve_chat_id_or_print
from ._output import default_structured_format, dump_structured, error_payload


@click.group("data")
def data_group():
    """Data management commands (registered at top-level)."""


@data_group.command("export")
@click.argument("chat", required=False)
@click.option("-f", "--format", "fmt", type=click.Choice(["text", "json", "yaml"]), default="text")
@click.option("-o", "--output", "output_file", help="Output file path")
@click.option("--hours", type=int, help="Only export last N hours")
@click.option("--media", help="Comma-separated media kinds to include (voice,video_note,docs,images,mp3,video)")
@click.option("--max-file-size", help="Max file size like 20MB")
@click.option("--since", help="Only export messages at or after this ISO timestamp")
@click.option("--until", help="Only export messages before this ISO timestamp")
@click.option("--scope", type=click.Choice(["personal", "all_chats", "all_channels"]), help="Export all dialogs in the selected scope")
def export(
    chat: str | None,
    fmt: str,
    output_file: str | None,
    hours: int | None,
    media: str | None,
    max_file_size: str | None,
    since: str | None,
    until: str | None,
    scope: str | None,
):
    """Export messages from CHAT or selected scope to text, JSON, or YAML."""
    with MessageDB() as db:
        if chat and scope:
            raise click.UsageError("Use either CHAT or --scope, not both.")
        if not chat and not scope:
            raise click.UsageError("Provide CHAT or --scope.")

        if scope:
            chat_ids = select_scope_chat_ids(db, scope=scope)
            msgs = []
            for chat_id in chat_ids:
                msgs.extend(db.get_recent(chat_id=chat_id, hours=hours if hours else None, limit=100000))
        else:
            chat_id = resolve_chat_id_or_print(db, chat)
            if chat_id is None:
                return
            if hours:
                msgs = db.get_recent(chat_id=chat_id, hours=hours, limit=100000)
            else:
                msgs = db.get_recent(chat_id=chat_id, hours=None, limit=100000)

    media_filters = {item.strip() for item in media.split(",") if item.strip()} if media else None
    filtered = filter_export_messages(
        msgs,
        media_filters=media_filters,
        max_file_size=parse_size_limit(max_file_size),
        since=since,
        until=until,
    )

    if not filtered:
        structured_fmt = (
            fmt
            if fmt in {"json", "yaml"}
            else default_structured_format(as_json=False, as_yaml=False)
        )
        if structured_fmt in {"json", "yaml"} and output_file is None:
            payload = error_payload("no_messages", f"No messages found.")
            click.echo(dump_structured(payload, fmt=structured_fmt))
            raise SystemExit(1) from None
        console.print(f"[yellow]No messages found.[/yellow]")
        return

    if fmt in {"json", "yaml"}:
        content = dump_structured(filtered, fmt=fmt)
    else:
        lines = []
        for msg in filtered:
            ts = (msg.get("timestamp") or "")[:19]
            sender = msg.get("sender_name") or "Unknown"
            text = msg.get("content") or ""
            lines.append(f"[{ts}] {sender}: {text}")
        content = "\n".join(lines)

    if output_file:
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(content)
        console.print(f"[green]✓[/green] Exported {len(filtered)} messages to {output_file}")
    else:
        console.print(content)


@data_group.command("purge")
@click.argument("chat")
@click.option("-y", "--yes", is_flag=True, help="Skip confirmation")
def purge(chat: str, yes: bool):
    """Delete all stored messages for CHAT."""
    with MessageDB() as db:
        chat_id = resolve_chat_id_or_print(db, chat)
        if chat_id is None:
            return

        if not yes:
            count = db.count(chat_id)
            if not click.confirm(f"Delete {count} messages from chat {chat_id}?"):
                return

        deleted = db.delete_chat(chat_id)
    console.print(f"[green]✓[/green] Deleted {deleted} messages")
