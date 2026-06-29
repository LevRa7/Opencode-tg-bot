#!/usr/bin/env python3
"""
OpenCode Research Failover Router
=================================
Standalone failover script for use with God'Agent experimental mode.

Takes a query (from session context where primary model returned incomplete),
routes it through fallback models in order:
  1. deepseek-v4-flash-free (via prefill proxy :8318)
  2. big-pickle (via prefill proxy :8318)

The prefill proxy auto-routes Zen models to opencode.ai/zen/v1 and injects
reliability enhancement formatting.

Returns the first successful response. If all fail, returns the error.

Usage:
    python3 failover.py "your query here"
    python3 failover.py "query" --json
    echo "query" | python3 failover.py
    python3 failover.py "query" --model "deepseek-v4-flash-free"  # single model
"""
import os, sys, json, time, argparse

try:
    from openai import OpenAI
except ImportError:
    print(json.dumps({"error": "openai package not installed"}))
    sys.exit(1)

# Auth key: read from env, or use the standard godmode provider key
GODMODE_API_KEY = os.environ.get(
    "GODMODE_API_KEY",
    "sk-z705gVI3NrXpmPo8J8YK04E1SKM9rLBY"
)

FALLBACK_CHAIN = [
    {"model": "deepseek-v4-flash-free", "base_url": "http://127.0.0.1:8318/v1"},
    {"model": "big-pickle", "base_url": "http://127.0.0.1:8318/v1"},
]

# Reasoning models that need generous max_tokens
# (prefill proxy auto-bumps these to min 400, but we set 4096 anyway)
REASONING_MIN_TOKENS = 4096

def route_query(query, json_output=False, single_model=None):
    """Route a query through fallback models. Returns first success."""
    chain = FALLBACK_CHAIN
    
    if single_model:
        known = {m["model"] for m in FALLBACK_CHAIN}
        if single_model in known:
            chain = [m for m in FALLBACK_CHAIN if m["model"] == single_model]
        else:
            chain = [{"model": single_model, "base_url": "http://127.0.0.1:8318/v1"}]
    
    last_error = None
    for step in chain:
        try:
            client = OpenAI(api_key=GODMODE_API_KEY, base_url=step["base_url"])
            resp = client.chat.completions.create(
                model=step["model"],
                messages=[{"role": "user", "content": query}],
                max_tokens=REASONING_MIN_TOKENS,
                timeout=120,
            )
            content = resp.choices[0].message.content.strip() if resp.choices else ""
            
            if content and len(content) > 10:
                if json_output:
                    print(json.dumps({
                        "success": True,
                        "model": step["model"],
                        "content": content,
                    }, ensure_ascii=False))
                else:
                    print(content)
                return
        except Exception as e:
            last_error = str(e)[:200]
            if json_output:
                print(json.dumps({"model": step["model"], "error": last_error}), file=sys.stderr)
            continue
    
    err = {"success": False, "error": f"All fallback models failed. Last: {last_error}"}
    if json_output:
        print(json.dumps(err, ensure_ascii=False))
    else:
        print(f"[FAILOVER ERROR] {last_error}", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Research failover router")
    parser.add_argument("query", nargs="?", help="Query to route")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--model", help="Use a single specific model instead of the chain")
    args = parser.parse_args()
    
    if args.query:
        route_query(args.query, args.json, args.model)
    elif not sys.stdin.isatty():
        query = sys.stdin.read().strip()
        if query:
            route_query(query, args.json, args.model)
    else:
        print("Usage: failover.py 'your query'", file=sys.stderr)
        print("       failover.py 'query' --json", file=sys.stderr)
        print("       failover.py 'query' --model big-pickle", file=sys.stderr)
        print("       echo 'query' | failover.py", file=sys.stderr)
        sys.exit(1)
