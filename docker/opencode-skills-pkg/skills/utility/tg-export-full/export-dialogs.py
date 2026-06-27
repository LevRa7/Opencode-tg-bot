#!/usr/bin/env python3
"""
export-dialogs.py — Полная выгрузка диалогов с людьми и их каналами.
Включает: текстовые сообщения (JSON), медиа (голос/фото/video_note).
Использует tg-cli для списка чатов и Telethon для загрузки.
"""
import asyncio, json, os, sys, subprocess
from pathlib import Path
from datetime import datetime, timezone, timedelta

sys.path.insert(0, '/home/me/.local/share/uv/tools/kabi-tg-cli/lib/python3.12/site-packages')
from telethon import TelegramClient
from telethon.tl.functions.users import GetFullUserRequest
from telethon.tl.types import (
    MessageMediaPhoto, MessageMediaDocument, DocumentAttributeVideo,
    User, Channel, Chat
)

API_ID = 2040
API_HASH = "b18441a1ff607e10a989891a5462e627"
SESSION = "/home/me/.local/share/tg-cli/tg_cli"

OUTPUT_DIR = Path(os.environ.get("EXPORT_DIR", "/home/me/opencode-tg/exports"))
CHATS_DIR = OUTPUT_DIR / "chats"
MEDIA_DIR = OUTPUT_DIR / "media"

MIN_MESSAGES = int(os.environ.get("EXPORT_MIN_MESSAGES", "20"))
MEDIA_SINCE_DAYS = int(os.environ.get("EXPORT_MEDIA_DAYS", "365"))
FETCH_MSG_LIMIT = int(os.environ.get("EXPORT_MSG_LIMIT", "5000"))

MEDIA_SINCE = datetime.now(timezone.utc) - timedelta(days=MEDIA_SINCE_DAYS)

def sanitize(name: str) -> str:
    return "".join(c if c.isalnum() or c in "_-." else "_" for c in (name or "unknown"))

async def get_conversation_partners(client) -> list[dict]:
    """Get list of user dialogs with > MIN_MESSAGES messages."""
    partners = []
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not isinstance(entity, User):
            continue
        if entity.bot:
            continue
        if not entity.first_name and not entity.last_name:
            continue
        
        # Count messages roughly
        msg_count = dialog.message.date.timestamp() if dialog.message else 0
        name = f"{entity.first_name or ''} {entity.last_name or ''}".strip()
        
        partners.append({
            "id": entity.id,
            "name": name,
            "username": entity.username,
            "dialog": dialog,
        })
    
    # Filter: need actual message count — fetch later
    return partners

async def get_user_channels(client, user_id: int) -> list[dict]:
    """Find channels owned by a user via GetFullUser."""
    try:
        full = await client(GetFullUserRequest(id=user_id))
        channels = []
        
        fu = full.full_user
        
        # Personal channel
        if hasattr(fu, 'personal_channel_id') and fu.personal_channel_id:
            try:
                ch = await client.get_entity(fu.personal_channel_id)
                channels.append({"id": ch.id, "title": getattr(ch, 'title', 'Channel'), "source": "personal_channel"})
            except:
                pass
        
        # Bio links
        import re
        bio = fu.about or ""
        for link in re.findall(r't\.me/([+\w]+)', bio):
            try:
                # Try public username first, then invite hash
                for identifier in [link, f"+{link}"]:
                    try:
                        ch = await client.get_entity(identifier)
                        channels.append({"id": ch.id, "title": getattr(ch, 'title', identifier), "source": f"bio:{link}"})
                        break
                    except:
                        continue
            except:
                pass
        
        return channels
    except Exception as e:
        return []

async def export_messages(client, entity, chat_id: int, label: str):
    """Export text messages as JSON."""
    json_path = CHATS_DIR / f"{label}.json"
    
    messages = []
    count = 0
    
    async for msg in client.iter_messages(entity, limit=FETCH_MSG_LIMIT):
        if msg.message:
            messages.append({
                "id": msg.id,
                "date": msg.date.isoformat(),
                "text": msg.message,
                "from_id": msg.from_id.user_id if msg.from_id else None,
                "reply_to": msg.reply_to.reply_to_msg_id if msg.reply_to else None,
            })
        count += 1
    
    messages.reverse()
    
    data = {
        "chat": getattr(entity, 'title', None) or f"{entity.first_name or ''} {entity.last_name or ''}".strip(),
        "chat_id": chat_id,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "message_count": len(messages),
        "total_fetched": count,
        "messages": messages,
    }
    
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    return len(messages)

async def download_media_for_chat(client, entity, chat_id: int, label: str):
    """Download voice, photo, video_note from the chat."""
    base = MEDIA_DIR / label
    dirs = {
        "voice": base / "voice",
        "photo": base / "photo",
        "video_note": base / "video_note",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    
    counts = {"voice": 0, "photo": 0, "video_note": 0, "total": 0}
    
    async for msg in client.iter_messages(entity, limit=FETCH_MSG_LIMIT):
        if msg.date < MEDIA_SINCE:
            break
        counts["total"] += 1
        
        if not msg.media:
            continue
        
        mt, ext = None, None
        if isinstance(msg.media, MessageMediaPhoto):
            mt, ext = "photo", ".jpg"
        elif isinstance(msg.media, MessageMediaDocument):
            doc = msg.media.document
            for a in doc.attributes:
                if isinstance(a, DocumentAttributeVideo) and a.round_message:
                    mt, ext = "video_note", ".mp4"
                    break
            if not mt and doc.mime_type and "audio" in doc.mime_type:
                mt, ext = "voice", ".ogg"
        
        if not mt:
            continue
        
        fp = dirs[mt] / f"{msg.date.strftime('%Y%m%d_%H%M%S')}_{msg.id}{ext}"
        if fp.exists():
            continue
        
        try:
            await client.download_media(msg, str(fp))
            counts[mt] += 1
        except:
            pass
    
    return counts

async def main():
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    me = await client.get_me()
    print(f"Connected: {me.first_name}")
    print(f"Media since: {MEDIA_SINCE.strftime('%Y-%m-%d')}")
    print(f"Output: {OUTPUT_DIR}\n")
    
    # Get all user dialogs
    print("Fetching dialogs...")
    partners = []
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not isinstance(entity, User) or entity.bot:
            continue
        name = f"{entity.first_name or ''} {entity.last_name or ''}".strip()
        if not name:
            continue
        partners.append({"id": entity.id, "name": name, "username": entity.username})
    
    print(f"Found {len(partners)} user dialogs\n")
    
    # Quick count messages per chat to filter
    qualified = []
    for i, p in enumerate(partners):
        try:
            entity = await client.get_entity(p["id"])
            count = 0
            async for msg in client.iter_messages(entity, limit=100):
                count += 1
            if count >= MIN_MESSAGES:
                p["msg_count"] = count
                qualified.append(p)
                print(f"  [{len(qualified)}] {p['name']} (@{p['username']}) — {count}+ messages")
            else:
                print(f"  [skip] {p['name']} — {count} messages (min {MIN_MESSAGES})")
        except Exception as e:
            print(f"  [err] {p['name']}: {e}")
        await asyncio.sleep(0.5)
    
    print(f"\n{len(qualified)} partners qualify (>={MIN_MESSAGES} messages)\n")
    
    # Export each partner + their channels
    total_msgs = 0
    total_media = {"voice": 0, "photo": 0, "video_note": 0}
    
    for i, p in enumerate(qualified):
        label = sanitize(p["name"])
        print(f"[{i+1}/{len(qualified)}] {p['name']}")
        
        try:
            entity = await client.get_entity(p["id"])
            
            # Export messages
            msgs = await export_messages(client, entity, p["id"], label)
            total_msgs += msgs
            print(f"  ✓ Messages: {msgs}")
            
            # Download media
            media = await download_media_for_chat(client, entity, p["id"], label)
            dl = sum(media.values())
            if dl > 0:
                print(f"  ✓ Media: {media}")
                for k in total_media:
                    total_media[k] += media[k]
            else:
                print(f"  - No media in last {MEDIA_SINCE_DAYS} days")
            
            # Find and export channels
            channels = await get_user_channels(client, p["id"])
            if channels:
                print(f"  🔍 Channels: {len(channels)}")
                for ch in channels:
                    ch_label = f"{label}_channel_{sanitize(ch['title'])}"
                    try:
                        ch_entity = await client.get_entity(ch["id"])
                        ch_msgs = await export_messages(client, ch_entity, ch["id"], ch_label)
                        ch_media = await download_media_for_chat(client, ch_entity, ch["id"], ch_label)
                        ch_dl = sum(ch_media.values())
                        print(f"    ✓ {ch['title']}: {ch_msgs} msgs, {ch_dl} media (source: {ch['source']})")
                        total_msgs += ch_msgs
                        for k in total_media:
                            total_media[k] += ch_media[k]
                    except Exception as e:
                        print(f"    ✗ {ch['title']}: {e}")
            
        except Exception as e:
            print(f"  ✗ ERROR: {e}")
        
        print()
        await asyncio.sleep(1)
    
    # Summary
    print(f"{'='*60}")
    print(f"EXPORT COMPLETE")
    print(f"Partners processed: {len(qualified)}")
    print(f"Total messages: {total_msgs}")
    print(f"Total media: voice={total_media['voice']} photo={total_media['photo']} video_note={total_media['video_note']}")
    print(f"Chats: {CHATS_DIR}")
    print(f"Media: {MEDIA_DIR}")
    
    await client.disconnect()

asyncio.run(main())
