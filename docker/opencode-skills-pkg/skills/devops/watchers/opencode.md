# Watchers

Poll external sources on an interval and react only to new items. Three ready-made scripts plus a shared watermark helper.

## When to Use

- User wants to watch an RSS/Atom feed for new entries
- User wants to watch a GitHub repo's issues/pulls/releases/commits
- User wants to poll an arbitrary JSON endpoint for new items
- User asks for "a watcher for X" or "notify me when X changes"

## Mental Model

A watcher is a script that: fetches data, compares against a watermark of previously-seen IDs, writes the new watermark back, prints new items to stdout (or nothing on no-change).

## Scripts

| Script | What it watches | Dedup key |
|--------|----------------|-----------|
| `watch_rss.py` | RSS 2.0 or Atom feed URL | `<guid>` / `<id>` |
| `watch_http_json.py` | Any JSON endpoint returning a list | Configurable id field |
| `watch_github.py` | GitHub issues/pulls/releases/commits | `id` / `sha` |

All three: first run records baseline (never replays), watermark capped at 500 IDs, empty stdout on no-change, non-zero exit on fetch errors.

## Usage

```bash
# RSS
python watch_rss.py --name hn --url https://news.ycombinator.com/rss --max 5

# GitHub (set GITHUB_TOKEN to avoid 60 req/hr limit)
python watch_github.py --name hermes-issues --repo org/repo --scope issues

# JSON API
python watch_http_json.py --name api --url https://api.example.com/events \
  --id-field event_id --items-path data.events
```

## State Files

Written to `./watcher-state/<name>.json`. Inspect with `cat`, force replay with `rm`.

## Writing Custom Watchers

Import the shared `_watermark.py` helper for atomic writes, bounded ID set, and first-run baseline. Empty stdout = silent — don't print "no new items" headers.
