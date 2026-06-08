#!/usr/bin/env python3
"""Telegram global music search — find and forward audio tracks via MTProto.

Uses messages.searchGlobal with InputMessagesFilterMusic to find music
across all public Telegram chats, then optionally forwards results.

Usage:
  ./tg-music-search.py "query"                     # Search + show results
  ./tg-music-search.py "query" --send "ChatName"   # Search + forward top N
  ./tg-music-search.py "query" --send "ChatName" --limit 20 --forward 5
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
from dataclasses import dataclass, field

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import GetHistoryRequest, SearchGlobalRequest
import tempfile

from telethon.tl.types import (
    InputMessagesFilterMusic,
    InputPeerEmpty,
    Message,
    MessageMediaDocument,
    DocumentAttributeAudio,
)

# Simple Cyrillic→Latin transliteration for search fallback
CYRILLIC_TO_LATIN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d",
    "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n",
    "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch",
    "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya",
    "А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D",
    "Е": "E", "Ё": "E", "Ж": "Zh", "З": "Z", "И": "I",
    "Й": "Y", "К": "K", "Л": "L", "М": "M", "Н": "N",
    "О": "O", "П": "P", "Р": "R", "С": "S", "Т": "T",
    "У": "U", "Ф": "F", "Х": "Kh", "Ц": "Ts", "Ч": "Ch",
    "Ш": "Sh", "Щ": "Shch", "Ъ": "", "Ы": "Y", "Ь": "",
    "Э": "E", "Ю": "Yu", "Я": "Ya",
}


def transliterate(text: str) -> str:
    return "".join(CYRILLIC_TO_LATIN.get(c, c) for c in text)


TG_API_ID = int(os.environ.get("TG_API_ID", "2040"))
TG_API_HASH = os.environ.get("TG_API_HASH", "b18441a1ff607e10a989891a5462e627")
SESSION_NAME = os.environ.get("TG_SESSION_NAME", "tg_cli")
DATA_DIR = os.environ.get(
    "DATA_DIR",
    os.path.expanduser("~/.local/share/tg-cli"),
)
SESSION_PATH = os.path.join(DATA_DIR, SESSION_NAME)
DB_PATH = os.path.join(DATA_DIR, "messages.db")

DEVICE_MODEL = "Desktop"
SYSTEM_VERSION = "macOS 15.3"
APP_VERSION = "5.12.1"
LANG_CODE = "en"


@dataclass
class Track:
    msg_id: int
    chat_id: int
    chat_title: str
    title: str
    artist: str
    duration: int
    file_size: int
    message: Message


def format_duration(seconds: int) -> str:
    m, s = divmod(seconds, 60)
    return f"{m}:{s:02d}"


def format_size(size: int) -> str:
    if size < 1024 * 1024:
        return f"{size / 1024:.0f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def extract_track_info(msg: Message) -> Track | None:
    media = msg.media
    if not media:
        return None

    audio_attr = None
    file_size = 0

    if isinstance(media, MessageMediaDocument):
        for attr in media.document.attributes:
            if isinstance(attr, DocumentAttributeAudio):
                audio_attr = attr
                break
        if audio_attr:
            file_size = media.document.size
    else:
        return None

    if not audio_attr:
        return None

    title = (audio_attr.title or "").strip() or msg.text or f"Track #{msg.id}"
    artist = (audio_attr.performer or "").strip() or "Unknown artist"
    chat_title = (
        getattr(msg.peer_id, "title", None)
        or getattr(getattr(msg, "chat", None), "title", None)
        or f"chat_{msg.chat_id}"
    )

    return Track(
        msg_id=msg.id,
        chat_id=msg.chat_id,
        chat_title=chat_title,
        title=title,
        artist=artist,
        duration=audio_attr.duration,
        file_size=file_size,
        message=msg,
    )


async def search_music(query: str, limit: int = 20) -> list[Track]:
    client = TelegramClient(
        SESSION_PATH,
        TG_API_ID,
        TG_API_HASH,
        device_model=DEVICE_MODEL,
        system_version=SYSTEM_VERSION,
        app_version=APP_VERSION,
        lang_code=LANG_CODE,
    )
    await client.start()

    tracks: list[Track] = []
    seen = set()

    queries_to_try = [query]
    latin = transliterate(query)
    if latin != query:
        queries_to_try.append(latin)

    try:
        for q in queries_to_try:
            try:
                result = await client(SearchGlobalRequest(
                    q=q,
                    filter=InputMessagesFilterMusic(),
                    min_date=None,
                    max_date=None,
                    offset_rate=0,
                    offset_peer=InputPeerEmpty(),
                    offset_id=0,
                    limit=limit,
                ))

                messages = getattr(result, "messages", []) or getattr(result, "messages", result)
                for msg in messages:
                    if not isinstance(msg, Message):
                        continue
                    track = extract_track_info(msg)
                    if track is None:
                        continue
                    key = (track.title.lower(), track.artist.lower(), track.duration)
                    if key in seen:
                        continue
                    seen.add(key)
                    tracks.append(track)
            except FloodWaitError as e:
                print(f"Rate limited: waiting {e.seconds}s...", file=sys.stderr)
                await asyncio.sleep(e.seconds + random.uniform(1, 5))
            except Exception as e:
                print(f"Search error for '{q}': {e}", file=sys.stderr)

            if len(tracks) >= limit:
                break
    finally:
        await client.disconnect()

    return tracks


async def forward_tracks(tracks: list[Track], target_chat: str, max_forward: int = 5):
    client = TelegramClient(
        SESSION_PATH,
        TG_API_ID,
        TG_API_HASH,
        device_model=DEVICE_MODEL,
        system_version=SYSTEM_VERSION,
        app_version=APP_VERSION,
        lang_code=LANG_CODE,
    )
    await client.start()

    try:
        target_entity = await client.get_entity(target_chat)

        sent = 0
        for track in tracks[:max_forward]:
            try:
                from_peer = await client.get_input_entity(track.chat_id)
                await client.forward_messages(
                    entity=target_entity,
                    messages=[track.msg_id],
                    from_peer=from_peer,
                )
                sent += 1
                print(f"  ✓ Forwarded: {track.artist} — {track.title}")
                await asyncio.sleep(0.5)
            except Exception as e:
                err_str = str(e)
                if "protected" in err_str:
                    # Fallback: download + re-upload
                    try:
                        print(f"  ⬇ Protected chat, downloading: {track.artist} — {track.title}")
                        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
                        tmp_path = tmp.name
                        tmp.close()
                        await client.download_media(track.message, file=tmp_path)
                        await client.send_file(target_entity, tmp_path)
                        os.unlink(tmp_path)
                        sent += 1
                        print(f"  ✓ Uploaded: {track.artist} — {track.title}")
                        await asyncio.sleep(0.5)
                    except Exception as e2:
                        print(f"  ✗ Failed to download/upload {track.title}: {e2}", file=sys.stderr)
                else:
                    print(f"  ✗ Failed to forward {track.title}: {e}", file=sys.stderr)

        return sent
    finally:
        await client.disconnect()


def print_tracks(tracks: list[Track]):
    if not tracks:
        print("No music tracks found.")
        return

    print(f"\nFound {len(tracks)} track(s):\n")
    for i, t in enumerate(tracks, 1):
        print(f"  {i:2d}. {t.artist} — {t.title}")
        print(f"      [{format_duration(t.duration)} | {format_size(t.file_size)}]")
        print(f"      Source: {t.chat_title}")
        print()


async def main():
    parser = argparse.ArgumentParser(
        description="Telegram global music search",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("query", help="Search query (artist, track name, etc.)")
    parser.add_argument("-n", "--limit", type=int, default=20, help="Max search results")
    parser.add_argument(
        "--send", metavar="CHAT",
        help="Forward found tracks to this chat/contact",
    )
    parser.add_argument(
        "--forward", type=int, default=5,
        help="Max tracks to forward when using --send (default: 5)",
    )

    args = parser.parse_args()

    print(f"🎵 Searching for: {args.query}")
    tracks = await search_music(args.query, limit=args.limit)
    print_tracks(tracks)

    if args.send and tracks:
        target = args.send
        print(f"📤 Forwarding up to {args.forward} tracks to {target}...")
        sent = await forward_tracks(tracks, target, max_forward=args.forward)
        print(f"\n✅ Forwarded {sent} track(s) to {target}")

    return 0 if tracks else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
