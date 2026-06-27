#!/usr/bin/env python3
"""
transcribe-chunks.py — Расшифровка медиа через Gemini 3 Flash с контекстом.
Каждый медиа-файл расшифровывается с учётом 30 предшествующих сообщений из чата.
Использует opencode-gemini-media прокси (http://127.0.0.1:18124).
"""
import asyncio, json, os, sys, subprocess
from pathlib import Path
from datetime import datetime

MEDIA_DIR = Path(os.environ.get("TRANSCRIBE_MEDIA_DIR", "/home/me/opencode-tg/exports/media-compressed"))
CHATS_DIR = Path(os.environ.get("TRANSCRIBE_CHATS_DIR", "/home/me/opencode-tg/exports/chats"))
OUTPUT_DIR = Path(os.environ.get("TRANSCRIBE_OUTPUT_DIR", "/home/me/opencode-tg/exports/transcripts"))
CONTEXT_WINDOW = int(os.environ.get("TRANSCRIBE_CONTEXT", "30"))
GEMINI_PROXY = os.environ.get("OPENCODE_GEMINI_MEDIA_PROXY_URL", "http://127.0.0.1:18124")
OCODE_MEDIA_BIN = "/home/me/MyProjects/opencode-tg/docker/bin/opencode-gemini-media"

# Mapping between chat dir names and export JSON files
def find_chat_json(chat_folder_name: str) -> Path | None:
    """Find the exported JSON for a given chat folder name."""
    for pattern in [
        f"{chat_folder_name}.json",
        f"chat_*.json",  # fallback
    ]:
        for f in CHATS_DIR.glob(pattern):
            # Match by reading the JSON to find matching title
            try:
                data = json.loads(f.read_text())
                title = data.get("chat") or data.get("data", {}).get("chat", "")
                if chat_folder_name.lower() in str(title).lower():
                    return f
            except:
                pass
    return None

def get_message_context(chat_json_path: Path, msg_date_str: str, window: int = 30) -> list[str]:
    """Get N preceding messages from the JSON export for context."""
    if not chat_json_path.exists():
        return []
    
    try:
        data = json.loads(chat_json_path.read_text())
        messages = data.get("messages") or data.get("data", {}).get("messages") or []
        
        # Parse target date from filename (format: YYYYMMDD_HHMMSS)
        try:
            target_dt = datetime.strptime(msg_date_str, "%Y%m%d_%H%M%S")
        except:
            return []
        
        # Collect messages before target date
        context = []
        for msg in messages:
            msg_date = msg.get("date")
            if msg_date:
                try:
                    dt = datetime.fromisoformat(msg_date.replace("Z", "+00:00"))
                    if dt < target_dt:
                        text = msg.get("text", "") or msg.get("message", "")
                        if text and text.strip():
                            context.append(text.strip())
                except:
                    pass
        
        # Return last N
        return context[-window:]
    except Exception as e:
        print(f"  ⚠ Context read error: {e}", file=sys.stderr)
        return []

def transcribe_media(file_path: Path, media_type: str, context_messages: list[str]) -> str | None:
    """Transcribe a media file using opencode-gemini-media proxy."""
    
    # Build context prompt
    context_prompt = ""
    if context_messages:
        ctx_text = "\n".join(f"[{i+1}] {m}" for i, m in enumerate(context_messages))
        context_prompt = (
            f"Context from previous {len(context_messages)} messages in this conversation:\n"
            f"{ctx_text}\n\n"
            f"Using this context, transcribe/describe the media. "
            f"Note any references to the context above.\n"
        )
    
    base_prompt = {
        "audio": "Produce a faithful transcript of the spoken audio. Include speaker identification if multiple speakers.",
        "video": "Describe the visual content briefly and transcribe any spoken audio.",
        "photo": "Describe the visible content and extract any readable text (OCR).",
    }
    
    prompt = context_prompt + base_prompt.get(media_type, "Describe this media.")
    
    try:
        # Read file as base64
        import base64
        file_buffer = file_path.read_bytes()
        file_b64 = base64.b64encode(file_buffer).decode()
        
        payload = {
            "mode": "photo" if media_type == "photo" else "audio" if media_type == "voice" else "video",
            "filePath": str(file_path),
            "filename": file_path.name,
            "prompt": prompt,
            "fileBase64": file_b64,
        }
        
        result = subprocess.run(
            ["node", "--no-warnings", "-e", f"""
                const fs = require('fs');
                const payload = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8'));
                fetch('{GEMINI_PROXY}/process', {{
                    method: 'POST',
                    headers: {{'Content-Type': 'application/json'}},
                    body: JSON.stringify(payload)
                }})
                .then(r => r.json())
                .then(d => process.stdout.write(d?.output ?? ''))
                .catch(e => {{ process.stderr.write(String(e)); process.exit(1); }});
            """],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        else:
            print(f"  ⚠ Gemini error: {result.stderr[:200]}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"  ⚠ Transcribe error for {file_path.name}: {e}", file=sys.stderr)
        return None

def main():
    if not MEDIA_DIR.exists():
        print(f"Media dir not found: {MEDIA_DIR}")
        sys.exit(1)
    
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    total = 0
    transcribed = 0
    failed = 0
    
    for chat_dir in sorted(MEDIA_DIR.iterdir()):
        if not chat_dir.is_dir():
            continue
        
        chat_name = chat_dir.name
        chat_json = find_chat_json(chat_name)
        
        chat_out = OUTPUT_DIR / chat_name
        chat_out.mkdir(parents=True, exist_ok=True)
        
        print(f"\n{'='*60}")
        print(f"Chat: {chat_name}")
        print(f"Chat JSON: {chat_json}")
        
        for media_type in ["voice", "photo", "video_note"]:
            src_dir = chat_dir / media_type
            if not src_dir.exists():
                continue
            
            files = sorted(src_dir.iterdir())
            if not files:
                continue
            
            out_dir = chat_out / media_type
            out_dir.mkdir(parents=True, exist_ok=True)
            
            print(f"  {media_type}: {len(files)} files")
            
            for f in files:
                if not f.is_file():
                    continue
                
                total += 1
                out_file = out_dir / f"{f.stem}.txt"
                
                if out_file.exists():
                    continue  # Already transcribed
                
                # Extract timestamp from filename (YYYYMMDD_HHMMSS_...)
                date_str = f.stem[:15] if len(f.stem) >= 15 else ""
                
                # Get context
                context = get_message_context(chat_json, date_str, CONTEXT_WINDOW) if chat_json else []
                ctx_len = len(context)
                
                # Determine media type
                mt = media_type if media_type != "voice" else "audio"
                
                print(f"    [{total}] {f.name} (ctx:{ctx_len}) ...", end=" ", flush=True)
                text = transcribe_media(f, media_type, context)
                
                if text:
                    out_file.write_text(text)
                    transcribed += 1
                    print(f"✓ {len(text)} chars")
                else:
                    failed += 1
                    print("✗")
    
    print(f"\n{'='*60}")
    print(f"DONE: {transcribed}/{total} transcribed, {failed} failed")
    print(f"Output: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
