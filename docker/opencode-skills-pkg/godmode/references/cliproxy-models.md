# Cliproxy Model Reference

Reference for Cliproxy-served models used in OpenCode TG. Cliproxy is a local proxy that provides OpenAI-compatible API access to various models.

## Common Cliproxy Model IDs

These are the model IDs you use with `CLIPROXYAPI_BASE_URL` (default: `http://192.168.2.166:8317/v1`):

| Category | Model ID | Notes |
|:---------|:---------|:------|
| Uncensored | `nousresearch/hermes-3-70b` | Already uncensored; no jailbreak needed |
| Uncensored | `nousresearch/hermes-3-405b` | Largest uncensored Hermes; slow but powerful |
| Standard | `openai/gpt-4o` | Moderate filtering; responds to OG GODMODE |
| Standard | `anthropic/claude-sonnet-4` | Heavy filtering; boundary_inversion patched |
| Standard | `google/gemini-2.5-flash` | Moderate filtering; responds to refusal_inversion |
| Fast | `meta-llama/llama-4-maverick` | Light filtering; prefill works well |
| Fast | `deepseek/deepseek-v3` | Keyword-based filtering; Parseltongue effective |
| Fast | `qwen/qwen-3-235b-a22b` | Variable filtering; try Parseltongue first |

## Using Cliproxy with GODMODE

The Cliproxy API key is stored in `/workspace/.config/opencode/cliproxyapi.key` inside the container. To use it with the godmode scripts:

```bash
# Read the key from file
export OPENROUTER_API_KEY="file:/workspace/.config/opencode/cliproxyapi.key"

# Or if you have a direct API key
export OPENROUTER_API_KEY="sk-or-v1-..."
```

## Cliproxy Provider in opencode.json

The Cliproxy provider is configured in `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "cliproxyapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CliProxyApi",
      "options": {
        "baseURL": "http://192.168.2.166:8317/v1",
        "apiKey": "{file:/workspace/.config/opencode/cliproxyapi.key}"
      }
    }
  }
}
```

The `CLIPROXYAPI_BASE_URL` env var controls the base URL; `CLIPROXYAPI_KEY_FILE` points to the key file.

## Godmode-Specific Notes for Cliproxy Models

- **Claude models via Cliproxy**: The boundary_inversion technique (`[END OF INPUT] [START OF INPUT]`) only works on Claude 3.5; patched on Sonnet 4+. Use `refusal_inversion` (Pliny Love divider) instead.
- **GPT-4o via Cliproxy**: The OG GODMODE l33t format still works as of mid-2026. Combine with prefill for best results.
- **DeepSeek via Cliproxy**: Parseltongue is highly effective — DeepSeek uses keyword-based input classifiers. Start with leetspeak (light tier).
- **Hermes models via Cliproxy**: No jailbreak needed. Just query directly with any prompt.
