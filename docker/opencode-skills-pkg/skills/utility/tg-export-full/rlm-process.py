#!/usr/bin/env python3
"""
rlm-process.py — RLM-обработка расшифровок через итеративные циклы.
Метод RLM (Recursive Language Models, github.com/alexzhang13/rlm):
данные → чанки → анализ → рекурсивная суммаризация → финальный вывод.

Использует Gemini для анализа каждого чанка и синтеза результата.
"""
import json, os, sys, subprocess
from pathlib import Path
from datetime import datetime

TRANSCRIPTS_DIR = Path(os.environ.get("RLM_TRANSCRIPTS_DIR", "/home/me/opencode-tg/exports/transcripts"))
CHATS_DIR = Path(os.environ.get("RLM_CHATS_DIR", "/home/me/opencode-tg/exports/chats"))
OUTPUT_DIR = Path(os.environ.get("RLM_OUTPUT_DIR", "/home/me/opencode-tg/exports/rlm-output"))
CHUNK_SIZE = int(os.environ.get("RLM_CHUNK_SIZE", "100"))  # lines per chunk
GEMINI_PROXY = os.environ.get("OPENCODE_GEMINI_MEDIA_PROXY_URL", "http://127.0.0.1:18124")

def ask_gemini(prompt: str, max_tokens: int = 4000) -> str:
    """Send a text-only query to Gemini via the proxy."""
    try:
        payload = {
            "mode": "text",
            "prompt": prompt,
            "fileBase64": "",
            "filename": "query.txt",
            "filePath": "",
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
            timeout=120,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return f"[ERROR: {result.stderr[:200]}]"
    except Exception as e:
        return f"[ERROR: {e}]"

def load_chat_data(chat_name: str) -> dict:
    """Load text messages and transcripts for a chat."""
    data = {"messages": [], "transcripts": [], "name": chat_name}
    
    # Load chat JSON
    for pattern in [f"{chat_name}.json", f"*{chat_name}*.json"]:
        for f in CHATS_DIR.glob(pattern):
            try:
                j = json.loads(f.read_text())
                msgs = j.get("messages") or j.get("data", {}).get("messages") or []
                for m in msgs:
                    text = m.get("text") or m.get("message") or ""
                    dt = m.get("date", "")
                    if text.strip():
                        data["messages"].append({"date": dt, "text": text.strip()})
            except:
                pass
    
    # Load transcripts
    tdir = TRANSCRIPTS_DIR / chat_name
    if tdir.exists():
        for media_type in ["voice", "photo", "video_note"]:
            mdir = tdir / media_type
            if mdir.exists():
                for tf in sorted(mdir.glob("*.txt")):
                    try:
                        text = tf.read_text().strip()
                        if text:
                            ts = tf.stem[:15]  # YYYYMMDD_HHMMSS
                            data["transcripts"].append({
                                "type": media_type,
                                "timestamp": ts,
                                "text": text,
                            })
                    except:
                        pass
    
    # Sort by date
    data["messages"].sort(key=lambda x: x["date"])
    data["transcripts"].sort(key=lambda x: x["timestamp"])
    
    return data

def chunk_text(text: str, size: int = CHUNK_SIZE) -> list[str]:
    """Split text into chunks of approximately `size` lines."""
    lines = text.split("\n")
    chunks = []
    for i in range(0, len(lines), size):
        chunks.append("\n".join(lines[i:i+size]))
    return chunks

def build_interleaved_timeline(data: dict) -> str:
    """Build an interleaved timeline of messages and transcripts."""
    lines = []
    
    # Combine messages and transcripts
    events = []
    for m in data["messages"]:
        events.append(("msg", m["date"], m["text"]))
    for t in data["transcripts"]:
        events.append(("transcript", t["timestamp"], f"[{t['type']}] {t['text']}"))
    
    events.sort(key=lambda x: x[1])
    
    for kind, ts, text in events:
        prefix = "📝" if kind == "msg" else {"voice": "🎤", "photo": "📷", "video_note": "🎥"}.get(
            text.split("]")[0].strip("["), "📎"
        )
        lines.append(f"{prefix} [{ts}] {text}")
    
    return "\n".join(lines)

def process_with_rlm(data: dict) -> str:
    """RLM-стиль обработки: chunk → analyze → synthesize."""
    chat_name = data["name"]
    timeline = build_interleaved_timeline(data)
    
    if len(timeline) < 500:
        # Small enough to process directly
        prompt = f"""Analyze this conversation history for {chat_name}.

The timeline includes both text messages and media transcripts (voice, photo, video_note).
Format: prefix [timestamp] content

Provide:
1. Summary of key topics discussed
2. Relationship dynamics visible in the conversation
3. Notable events, dates, decisions
4. Communication patterns (who initiates, response times, media sharing habits)
5. Any recurring themes or inside references

Timeline:
{timeline[:10000]}
"""
        return ask_gemini(prompt)
    
    # Large: chunk and process recursively (RLM pattern)
    chunks = chunk_text(timeline)
    summaries = []
    
    print(f"  Processing {len(chunks)} chunks for {chat_name}...")
    
    # Phase 1: Summarize each chunk
    for i, chunk in enumerate(chunks):
        prompt = f"""Summarize this conversation segment from {chat_name} (chunk {i+1}/{len(chunks)}).

Extract:
- Key topics and decisions
- Important timestamps/events
- Notable media shared (voice, photos, videos)
- Communication patterns

Segment:
{chunk[:8000]}
"""
        summary = ask_gemini(prompt)
        summaries.append(summary)
        print(f"    Chunk {i+1}/{len(chunks)}: {len(summary)} chars")
    
    # Phase 2: Synthesize from summaries
    all_summaries = "\n\n---\n\n".join(
        f"CHUNK {i+1}:\n{s}" for i, s in enumerate(summaries)
    )
    
    synth_prompt = f"""Synthesize these chunk summaries into a comprehensive analysis of the conversation with {chat_name}.

Chunk summaries:
{all_summaries[:15000]}

Provide a structured report:
1. Overall summary (3-5 sentences)
2. Key topics (bullet points with dates)
3. Relationship dynamics
4. Media sharing patterns (voice, photos, video notes)
5. Notable interactions and events
6. Communication style insights
"""
    return ask_gemini(synth_prompt, max_tokens=6000)

def main():
    if not TRANSCRIPTS_DIR.exists():
        print(f"Transcripts dir not found: {TRANSCRIPTS_DIR}")
        sys.exit(1)
    
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Process each chat
    for chat_dir in sorted(TRANSCRIPTS_DIR.iterdir()):
        if not chat_dir.is_dir():
            continue
        
        chat_name = chat_dir.name
        out_file = OUTPUT_DIR / f"{chat_name}_analysis.md"
        
        if out_file.exists():
            print(f"Skip {chat_name} (already analyzed)")
            continue
        
        print(f"\n{'='*60}")
        print(f"RLM Processing: {chat_name}")
        
        data = load_chat_data(chat_name)
        msg_count = len(data["messages"])
        tr_count = len(data["transcripts"])
        print(f"  Messages: {msg_count}, Transcripts: {tr_count}")
        
        if msg_count == 0 and tr_count == 0:
            print(f"  Skip: no data")
            continue
        
        analysis = process_with_rlm(data)
        
        # Write Markdown report
        report = f"""# Conversation Analysis: {chat_name}
*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*
*Messages: {msg_count}, Media transcripts: {tr_count}*

{analysis}
"""
        out_file.write_text(report)
        print(f"  ✓ Saved: {out_file}")
    
    print(f"\n{'='*60}")
    print(f"DONE. Reports in: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
