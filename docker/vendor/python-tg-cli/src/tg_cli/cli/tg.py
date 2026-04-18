"""Telegram subcommands — send, edit, delete, and more."""

import asyncio
import json
import subprocess
import sys
import time

import click
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from ..background_sync import run_background_sync
from ..client import (
    begin_phone_login,
    complete_password_login,
    complete_phone_login,
    complete_qr_login,
    connect,
    fetch_history,
    get_chat_info,
    list_chats,
    listen,
    login_with_qr,
    run_qr_login_worker,
    clear_qr_login_state,
)
from ..console import console
from ..db import MessageDB
from ._chat import _parse_chat, resolve_chat_id_or_print
from ._output import (
    default_structured_format,
    dump_structured,
    emit_structured,
    error_payload,
    structured_output_options,
    success_payload,
)


def _stream_json_payload(payload: dict) -> None:
    """Emit one structured JSON line immediately for streaming consumers."""
    click.echo(json.dumps(success_payload(payload), ensure_ascii=False, separators=(",", ":")))
from ._sync import sync_all_dialogs, sync_chat_dialog


def _telegram_user_payload(me) -> dict[str, str | int]:
    """Normalize Telegram user info for structured agent output."""
    name = " ".join(part for part in [me.first_name, me.last_name] if part).strip()
    return {
        "id": me.id,
        "name": name,
        "username": me.username or "",
        "first_name": me.first_name or "",
        "last_name": me.last_name or "",
        "phone": me.phone or "",
    }


def _spawn_qr_login_worker() -> int:
    process = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import asyncio, os; "
                "from tg_cli.client import run_qr_login_worker; "
                "asyncio.run(run_qr_login_worker(worker_pid=os.getpid()))"
            ),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return int(process.pid)


@click.group("tg")
def tg_group():
    """Telegram operations — connect, fetch, sync, listen."""
    pass


@tg_group.command("chats")
@click.option("--type", "chat_type", help="Filter by type: user, group, supergroup, channel")
@structured_output_options
def tg_chats(chat_type: str | None, as_json: bool, as_yaml: bool):
    """List joined Telegram chats."""

    async def _run():
        async with connect() as client:
            return await list_chats(client, chat_type)

    chats = asyncio.run(_run())
    if emit_structured(chats, as_json=as_json, as_yaml=as_yaml):
        return

    table = Table(title="Telegram Chats")
    table.add_column("ID", style="dim")
    table.add_column("Name", style="bold")
    table.add_column("Type", style="cyan")
    table.add_column("Unread", justify="right")

    for c in chats:
        table.add_row(str(c["id"]), c["name"], c["type"], str(c["unread"]))

    console.print(table)
    console.print(f"\nTotal: {len(chats)} chats")


@tg_group.command("history")
@click.argument("chat")
@click.option("-n", "--limit", default=1000, help="Max messages to fetch")
@structured_output_options
def tg_history(chat: str, limit: int, as_json: bool, as_yaml: bool):
    """Fetch historical messages from CHAT (name, username, or numeric ID)."""

    async def _run():
        with MessageDB() as db:
            async with connect() as client:
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    console=console,
                ) as progress:
                    task = progress.add_task(f"Fetching messages from {chat}...", total=None)

                    def on_progress(count: int):
                        progress.update(task, description=f"Stored {count} messages...")

                    count = await fetch_history(
                        client, _parse_chat(chat), limit=limit, db=db, on_progress=on_progress
                    )
                return count

    count = asyncio.run(_run())
    payload = {"stored": count, "chat": chat}
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"\n[green]\u2713[/green] Stored {count} messages from {chat}")


@tg_group.command("sync")
@click.argument("chat")
@click.option("-n", "--limit", default=5000, help="Max messages per sync")
@structured_output_options
def tg_sync(chat: str, limit: int, as_json: bool, as_yaml: bool):
    """Incremental sync — fetch only new messages from CHAT."""

    async def _run():
        with MessageDB() as db:
            # Resolve chat_id to get last_msg_id
            chat_id = resolve_chat_id_or_print(db, chat, allow_missing=True)
            matches = db.find_chats(chat)
            if len(matches) > 1:
                resolve_chat_id_or_print(db, chat)
                return None
            last_id = db.get_last_msg_id(chat_id) if chat_id else 0
        if last_id:
            console.print(f"Syncing from msg_id > {last_id}...")

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task_id = progress.add_task(f"Syncing {chat}...", total=None)

            def on_progress(count: int):
                progress.update(task_id, description=f"Stored {count} new messages...")

            return await sync_chat_dialog(chat, limit=limit, on_progress=on_progress)

    count = asyncio.run(_run())
    if count is None:
        return
    payload = {"synced": count, "chat": chat}
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"\n[green]\u2713[/green] Synced {count} new messages from {chat}")


@tg_group.command("sync-all")
@click.option("-n", "--limit", default=5000, help="Max messages per chat")
@click.option(
    "--delay",
    default=1.0,
    show_default=True,
    help="Seconds between chat syncs (anti-ban). Set 0 to disable.",
)
@click.option(
    "--max-chats",
    default=None,
    type=int,
    help="Max number of chats to sync per run (default: all)",
)
@structured_output_options
def tg_sync_all(limit: int, delay: float, max_chats: int | None, as_json: bool, as_yaml: bool):
    """Sync all currently available Telegram dialogs with a single connection."""

    async def _run():
        on_chat_done = None
        if not as_json and not as_yaml:
            console.print("Syncing all available chats...")

            def _on_chat_done(name: str, new_count: int, total: int):
                if new_count > 0:
                    console.print(f"  [green]✓[/green] {name}: +{new_count} (total: {total})")
                else:
                    console.print(f"  [dim]✓ {name}: no new messages[/dim]")

            on_chat_done = _on_chat_done

        return await sync_all_dialogs(
            limit=limit, on_chat_done=on_chat_done, delay=delay, max_chats=max_chats
        )

    results = asyncio.run(_run())
    total_new = sum(results.values())
    payload = {"new_messages": total_new, "chats": len(results), "results": results}
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"\n[green]✓[/green] Synced {total_new} new messages across {len(results)} chats")


@tg_group.command("refresh")
@click.option("-n", "--limit", default=5000, help="Max messages per chat")
@click.option(
    "--delay",
    default=1.0,
    show_default=True,
    help="Seconds between chat syncs (anti-ban). Set 0 to disable.",
)
@click.option(
    "--max-chats",
    default=None,
    type=int,
    help="Max number of chats to sync per run (default: all)",
)
@structured_output_options
def tg_refresh(limit: int, delay: float, max_chats: int | None, as_json: bool, as_yaml: bool):
    """Refresh the local cache from all current Telegram dialogs."""

    async def _run():
        on_chat_done = None
        if not as_json and not as_yaml:
            console.print("Refreshing local cache...")

            def _on_chat_done(name: str, new_count: int, total: int):
                if new_count > 0:
                    console.print(f"  [green]✓[/green] {name}: +{new_count} (total: {total})")
                else:
                    console.print(f"  [dim]✓ {name}: no new messages[/dim]")

            on_chat_done = _on_chat_done

        return await sync_all_dialogs(
            limit=limit, on_chat_done=on_chat_done, delay=delay, max_chats=max_chats
        )

    results = asyncio.run(_run())
    total_new = sum(results.values())
    updated = [
        name
        for name, count in sorted(results.items(), key=lambda item: (-item[1], item[0]))
        if count > 0
    ]
    payload = {
        "new_messages": total_new,
        "chats": len(results),
        "updated_chats": updated,
        "results": results,
    }
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return

    console.print(f"\n[green]✓[/green] Refreshed {len(results)} chats, {total_new} new messages.")
    if updated:
        console.print(f"[dim]Most recently updated: {', '.join(updated[:5])}[/dim]")


@tg_group.command("listen")
@click.argument("chats", nargs=-1)
@click.option("--persist", is_flag=True, help="Reconnect automatically if the connection drops")
@click.option(
    "--retry-seconds",
    default=5,
    show_default=True,
    help="Reconnect delay when using --persist",
)
def tg_listen(chats: tuple[str, ...], persist: bool, retry_seconds: int):
    """Real-time listener for new messages. Optionally specify CHATS to filter."""
    parsed: list[str | int] | None = None
    if chats:
        parsed = []
        for c in chats:
            try:
                parsed.append(int(c))
            except ValueError:
                parsed.append(c)

    if persist:
        asyncio.run(run_background_sync(chats=parsed, retry_seconds=retry_seconds))
        return

    async def _run_once():
        async with connect() as client:
            return await listen(client, chats=parsed)

    asyncio.run(_run_once())


@tg_group.command("info")
@click.argument("chat")
@structured_output_options
def tg_info(chat: str, as_json: bool, as_yaml: bool):
    """Show detailed info about CHAT."""

    async def _run():
        async with connect() as client:
            return await get_chat_info(client, _parse_chat(chat))

    info = asyncio.run(_run())
    if not info:
        console.print(f"[red]Could not find chat: {chat}[/red]")
        return

    if emit_structured(info, as_json=as_json, as_yaml=as_yaml):
        return

    table = Table(title="Chat Info", show_header=False)
    table.add_column("Field", style="bold")
    table.add_column("Value")

    for k, v in info.items():
        table.add_row(k, v)

    console.print(table)


@tg_group.command("login-start")
@click.argument("phone")
@structured_output_options
def tg_login_start(phone: str, as_json: bool, as_yaml: bool):
    """Request a Telegram login code for PHONE."""

    payload = asyncio.run(begin_phone_login(phone))
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    if payload.get("authenticated"):
        console.print("[green]✓[/green] Already authenticated")
        return
    console.print(f"[green]✓[/green] Verification code requested for {phone}")
    if payload.get("timeout") is not None:
        console.print(f"[dim]Code expires in {payload['timeout']}s[/dim]")


@tg_group.command("login-complete")
@click.argument("phone")
@click.argument("code")
@click.option("--phone-code-hash", required=True, help="Hash returned by login-start")
@structured_output_options
def tg_login_complete(phone: str, code: str, phone_code_hash: str, as_json: bool, as_yaml: bool):
    """Complete Telegram login with PHONE, CODE, and PHONE_CODE_HASH."""

    payload = asyncio.run(complete_phone_login(phone, code, phone_code_hash))
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    if payload.get("password_required"):
        console.print("[yellow]2FA password required. Run login-password.[/yellow]")
        return
    if payload.get("auth_key_unregistered"):
        console.print("[red]Session expired. Run login-start again.[/red]")
        return
    console.print("[green]✓[/green] Authenticated")


@tg_group.command("login-password")
@click.option("--password", required=False, hide_input=True, help="Telegram 2FA password")
@structured_output_options
def tg_login_password(password: str | None, as_json: bool, as_yaml: bool):
    """Complete Telegram login with 2FA password."""

    fmt = default_structured_format(as_json=as_json, as_yaml=as_yaml)
    if password is None:
        if fmt is not None:
            raise click.UsageError("Missing option '--password'.")
        password = click.prompt("Telegram 2FA password", hide_input=True)

    payload = asyncio.run(complete_password_login(password))
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    if payload.get("auth_key_unregistered"):
        console.print("[red]Session expired. Run login-qr or login-start again.[/red]")
        return
    console.print("[green]✓[/green] Authenticated")


@tg_group.command("login-qr")
@click.option("--wait", "wait_for_scan", is_flag=True, help="Wait for QR scan and finish login in one command")
@click.option("--wait-timeout", type=float, default=None, help="Seconds to wait for QR scan when using --wait")
@structured_output_options
def tg_login_qr(wait_for_scan: bool, wait_timeout: float | None, as_json: bool, as_yaml: bool):
    """Generate a QR image for Telegram login."""

    fmt = default_structured_format(as_json=as_json, as_yaml=as_yaml)

    async def _run():
        if wait_for_scan:
            if fmt == "json":
                async def _on_qr_ready(event_payload: dict) -> None:
                    _stream_json_payload(event_payload)

                return await login_with_qr(wait_timeout=wait_timeout, on_qr_ready=_on_qr_ready)
            return await login_with_qr(wait_timeout=wait_timeout)
        return None

    if not wait_for_scan:
        clear_qr_login_state()
        worker_pid = _spawn_qr_login_worker()
        deadline = time.time() + 5.0
        payload = None
        while time.time() < deadline:
            state = complete_qr_login()
            if state.get("event") in {"qr_ready", "authenticated", "password_required"}:
                payload = {**state, "worker_pid": worker_pid, "next_step": "status"}
                break
            time.sleep(0.05)
        if payload is None:
            payload = {
                "event": "starting",
                "authenticated": False,
                "pending": True,
                "password_required": False,
                "worker_pid": worker_pid,
                "next_step": "status",
            }
    else:
        payload = asyncio.run(_run())
    if wait_for_scan and fmt == "json":
        _stream_json_payload(payload)
        return
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    if payload.get("password_required"):
        console.print("[yellow]QR scanned. 2FA password required. Run tg login-password.[/yellow]")
        return
    if payload.get("authenticated"):
        console.print("[green]✓[/green] Authenticated")
        return
    if payload.get("png_path"):
        console.print(f"[green]✓[/green] QR code written to {payload['png_path']}")
    console.print("[dim]Waiting for scan in background. Check with: tg status[/dim]")
    console.print("[dim]If Telegram asks for 2FA after scan, run: tg login-password[/dim]")


@tg_group.command("whoami")
@structured_output_options
def tg_whoami(as_json: bool, as_yaml: bool):
    """Show current logged-in user info."""

    async def _run():
        async with connect() as client:
            me = await client.get_me()
            return me

    fmt = default_structured_format(as_json=as_json, as_yaml=as_yaml)
    try:
        me = asyncio.run(_run())
    except Exception as exc:
        if fmt is not None:
            click.echo(dump_structured(error_payload("auth_error", str(exc)), fmt=fmt))
            raise SystemExit(1) from None
        raise click.ClickException(str(exc)) from exc

    info = _telegram_user_payload(me)

    if emit_structured(success_payload({"user": info}), as_json=as_json, as_yaml=as_yaml):
        return

    name = " ".join(p for p in [me.first_name, me.last_name] if p)
    table = Table(title=f"👤 {name}")
    table.add_column("Field", style="bold cyan")
    table.add_column("Value", style="green")
    table.add_row("ID", str(me.id))
    table.add_row("Name", name)
    if me.username:
        table.add_row("Username", f"@{me.username}")
    if me.phone:
        table.add_row("Phone", f"+{me.phone}")

    console.print(table)


@tg_group.command("status")
@structured_output_options
def tg_status(as_json: bool, as_yaml: bool):
    """Show Telegram authentication status."""

    qr_state = complete_qr_login()
    if qr_state.get("pending") or qr_state.get("password_required") or qr_state.get("authenticated"):
        if qr_state.get("authenticated") and qr_state.get("user"):
            if emit_structured(success_payload(qr_state), as_json=as_json, as_yaml=as_yaml):
                return
            user = qr_state["user"]
            name = " ".join(part for part in [user.get("first_name", ""), user.get("last_name", "")] if part).strip()
            console.print(f"[green]✓[/green] Authenticated as [bold]{name or user.get('id')}[/bold]")
            if user.get("username"):
                console.print(f"[dim]@{user['username']}[/dim]")
            return
        if emit_structured(success_payload(qr_state), as_json=as_json, as_yaml=as_yaml):
            return
        if qr_state.get("password_required"):
            console.print("[yellow]QR scanned. 2FA password required. Run tg login-password.[/yellow]")
            return
        console.print("[yellow]Waiting for QR scan in background.[/yellow]")
        png_path = qr_state.get("png_path")
        if png_path:
            console.print(f"[dim]QR file: {png_path}[/dim]")
        return

    async def _run():
        async with connect() as client:
            me = await client.get_me()
            return {
                "authenticated": True,
                "id": me.id,
                "first_name": me.first_name or "",
                "last_name": me.last_name or "",
                "username": me.username or "",
                "phone": me.phone or "",
            }

    fmt = default_structured_format(as_json=as_json, as_yaml=as_yaml)
    try:
        info = asyncio.run(_run())
    except Exception as exc:
        if fmt is not None:
            click.echo(dump_structured(error_payload("auth_error", str(exc)), fmt=fmt))
            raise SystemExit(1) from None
        raise click.ClickException(str(exc)) from exc

    user = {key: value for key, value in info.items() if key != "authenticated"}
    if emit_structured(
        success_payload({"authenticated": True, "user": user}),
        as_json=as_json,
        as_yaml=as_yaml,
    ):
        return

    name = " ".join(part for part in [info["first_name"], info["last_name"]] if part).strip()
    console.print(f"[green]✓[/green] Authenticated as [bold]{name or info['id']}[/bold]")
    if info["username"]:
        console.print(f"[dim]@{info['username']}[/dim]")


@tg_group.command("send")
@click.argument("chat")
@click.argument("message")
@click.option("-r", "--reply", type=int, default=None, help="Message ID to reply to")
@click.option("--no-preview", is_flag=True, help="Disable link preview")
@structured_output_options
def tg_send(
    chat: str,
    message: str,
    reply: int | None,
    no_preview: bool,
    as_json: bool,
    as_yaml: bool,
):
    """Send a MESSAGE to CHAT (name, username, or numeric ID)."""

    async def _run():
        async with connect() as client:
            msg = await client.send_message(
                _parse_chat(chat),
                message,
                reply_to=reply,
                link_preview=not no_preview,
            )
            return msg

    msg = asyncio.run(_run())
    payload = {"sent": True, "msg_id": msg.id, "chat": chat}
    if reply is not None:
        payload["reply_to"] = reply
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"[green]\u2713[/green] Message sent (id: {msg.id})")


@tg_group.command("edit")
@click.argument("chat")
@click.argument("msg_id", type=int)
@click.argument("new_text")
@click.option("--no-preview", is_flag=True, help="Disable link preview")
@structured_output_options
def tg_edit(chat: str, msg_id: int, new_text: str, no_preview: bool, as_json: bool, as_yaml: bool):
    """Edit a previously sent message. CHAT MSG_ID NEW_TEXT."""

    async def _run():
        async with connect() as client:
            return await client.edit_message(
                _parse_chat(chat),
                msg_id,
                new_text,
                link_preview=not no_preview,
            )

    asyncio.run(_run())
    payload = {"edited": True, "msg_id": msg_id, "chat": chat}
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"[green]\u2713[/green] Message {msg_id} edited")


@tg_group.command("delete")
@click.argument("chat")
@click.argument("msg_ids", nargs=-1, type=int, required=True)
@structured_output_options
def tg_delete(chat: str, msg_ids: tuple[int, ...], as_json: bool, as_yaml: bool):
    """Delete one or more messages. CHAT MSG_ID [MSG_ID ...]."""

    async def _run():
        async with connect() as client:
            await client.delete_messages(_parse_chat(chat), list(msg_ids))

    asyncio.run(_run())
    payload = {"deleted": True, "msg_ids": list(msg_ids), "chat": chat}
    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):
        return
    console.print(f"[green]\u2713[/green] Deleted {len(msg_ids)} message(s)")
