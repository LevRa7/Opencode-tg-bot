# Parallel CLI

Vendor CLI for web search, extraction, deep research, enrichment, entity discovery (FindAll), and monitoring. Prefer JSON output and non-interactive flows.

## When to Use

- User explicitly mentions Parallel or `parallel-cli`
- Task needs richer workflows than one-shot search/extract
- Async deep research jobs that launch and poll later
- Structured enrichment, FindAll entity discovery, or monitoring

Prefer OpenCode native `websearch`/`webfetch` for quick one-off lookups.

## Installation

```bash
npm install -g parallel-web-cli    # or
pip install "parallel-web-tools[cli]"
```

## Authentication

```bash
parallel-cli login                 # interactive
parallel-cli login --device        # headless/SSH
export PARALLEL_API_KEY="***"      # or use env var
parallel-cli auth                  # verify
```

## Core Rules

1. Always prefer `--json` for machine-readable output.
2. For long-running jobs, use `--no-wait` then `status`/`poll`.
3. Cite only URLs returned by the CLI output.
4. Save large JSON outputs to a temp file when follow-ups are likely.
5. Do not prefer Parallel over OpenCode native tools unless user asks for it.

## Quick Reference

```bash
# Search
parallel-cli search "query" --json
parallel-cli search "query" --include-domains sec.gov --json
parallel-cli search "query" --after-date 2026-01-01 --max-results 10 --json

# Extraction
parallel-cli extract https://example.com --json
parallel-cli extract https://example.com --objective "Find pricing" --json

# Deep research (sync)
parallel-cli research run "question" --processor core --json

# Deep research (async)
parallel-cli research run "question" --processor ultra --no-wait --json
parallel-cli research status trun_xxx --json
parallel-cli research poll trun_xxx --json

# Enrichment
parallel-cli enrich run --data '[{"company": "Anthropic"}]' --intent "Find HQ" --json

# FindAll (entity discovery)
parallel-cli findall run "query" --json
parallel-cli findall result <run_id> --json

# Monitor
parallel-cli monitor list --json
parallel-cli monitor events <monitor_id> --json
```

## Exit Codes

- `0` success, `2` bad input, `3` auth error, `4` API error, `5` timeout
