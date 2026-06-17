# Whisper — Robust Speech Recognition

OpenAI's multilingual speech recognition model. 99 languages, transcription, translation to English, language identification.

## When to Use

- Speech-to-text transcription (99 languages)
- Podcast/video transcription
- Meeting notes automation
- Translation to English
- Noisy audio transcription

## Installation

```bash
pip install -U openai-whisper
# Requires ffmpeg: brew install ffmpeg / apt install ffmpeg / choco install ffmpeg
```

## Model Sizes

| Model | Params | Speed | VRAM |
|-------|--------|-------|------|
| tiny | 39M | ~32x | ~1 GB |
| base | 74M | ~16x | ~1 GB |
| small | 244M | ~6x | ~2 GB |
| medium | 769M | ~2x | ~5 GB |
| large | 1550M | 1x | ~10 GB |
| turbo | 809M | ~8x | ~6 GB |

Recommendation: `turbo` for best speed/quality, `base` for prototyping.

## Basic Usage

```python
import whisper
model = whisper.load_model("turbo")
result = model.transcribe("audio.mp3")
print(result["text"])
```

### Transcription Options

```python
# Specify language (faster than auto-detect)
result = model.transcribe("audio.mp3", language="en")

# Translation to English
result = model.transcribe("spanish.mp3", task="translate")

# Initial prompt for domain-specific vocabulary
result = model.transcribe("audio.mp3", initial_prompt="Technical podcast about ML")

# Word-level timestamps
result = model.transcribe("audio.mp3", word_timestamps=True)
```

### CLI

```bash
whisper audio.mp3 --model turbo --output_format txt|srt|vtt|json
whisper audio.mp3 --language Spanish --task translate
```

### GPU Acceleration

```python
model = whisper.load_model("turbo")           # auto GPU
model = whisper.load_model("turbo", device="cpu")   # force CPU
model = whisper.load_model("turbo", device="cuda")  # force GPU
```

## Best Practices

1. Use turbo model for best speed/quality
2. Specify language (faster than auto-detect)
3. Add initial prompt for technical terms
4. Use GPU (10-20x faster)
5. Split long audio into <30 min chunks
6. Use `faster-whisper` for 4x speed: `pip install faster-whisper`

## Limitations

- May hallucinate/repeat text
- Quality degrades on >30 min audio
- No speaker diarization
- Accent quality varies
- Not suitable for live captioning
