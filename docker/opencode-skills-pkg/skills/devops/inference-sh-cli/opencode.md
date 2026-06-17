# inference.sh CLI

Run 150+ AI apps in the cloud with the `infsh` CLI. No GPU required.

## When to Use

- Generate images (FLUX, Reve, Seedream, Grok, Gemini image)
- Generate video (Veo, Wan, Seedance, OmniHuman)
- Run AI apps without managing individual provider APIs
- AI-powered search (Tavily, Exa)
- Avatar/lipsync generation

## Prerequisites

```bash
infsh me    # check auth
```

If not installed: `curl -fsSL https://cli.inference.sh | sh && infsh login`.

## Workflow

### 1. Always Search First — never guess app IDs

```bash
infsh app list --search flux
infsh app list --search video
infsh app list --search image
infsh app list --search search
infsh app list --search 3d
infsh app list --search tts
```

### 2. Run an App

Always use `--json` for machine-readable output:

```bash
infsh app run <app-id> --input '{"prompt": "sunset over mountains", "num_images": 1}' --json
```

### 3. Parse Output

JSON output contains URLs to generated media. Present to the user.

## Common Commands

### Image Generation

```bash
infsh app run falai/flux-dev-lora --input '{"prompt": "sunset", "num_images": 1}' --json
infsh app run google/gemini-2-5-flash-image --input '{"prompt": "futuristic city"}' --json
infsh app run bytedance/seedream-5-lite --input '{"prompt": "nature scene"}' --json
infsh app run xai/grok-imagine-image --input '{"prompt": "abstract art"}' --json
```

### Video Generation

```bash
infsh app run google/veo-3-1-fast --input '{"prompt": "drone shot of coastline"}' --json
infsh app run bytedance/seedance-1-5-pro --input '{"prompt": "dancing figure"}' --json
infsh app run falai/wan-2-5 --input '{"prompt": "person walking"}' --json
```

### Local File Uploads

```bash
infsh app run falai/topaz-image-upscaler --input '{"image": "/path/to/photo.jpg", "upscale_factor": 2}' --json
infsh app run bytedance/omnihuman-1-5 --input '{"audio": "/path/to/audio.mp3", "image": "/path/to/face.jpg"}' --json
```

### Search & Research

```bash
infsh app run tavily/tavily-search --input '{"query": "latest AI news"}' --json
infsh app run exa/exa-search --input '{"query": "machine learning papers"}' --json
```

## Pitfalls

1. Never guess app IDs — always search first
2. Always use `--json`
3. Video generation can take 30-120 seconds
4. Check auth with `infsh me` if commands fail
