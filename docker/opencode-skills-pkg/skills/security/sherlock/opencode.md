# Sherlock OSINT Username Search

Hunt down social media accounts by username across 400+ networks.

## When to Use

- User asks to find accounts associated with a username
- User wants to check username availability across platforms
- User asks "where is this username registered?"

## Prerequisites

```bash
sherlock --version
```

If not installed: `pipx install sherlock-project` (recommended) or `pip install sherlock-project`. Docker also available: `docker run -it --rm sherlock/sherlock`.

## Procedure

### 1. Extract Username

Extract directly from the user's message. Do NOT ask clarifying questions if the username is clear. Only clarify if multiple usernames, ambiguous phrasing, or none mentioned.

### 2. Run Search

```bash
sherlock --print-found --no-color "<username>" --timeout 90
```

Optional flags (only if user explicitly requests): `--nsfw`, `--tor`.

### 3. Present Results

Format: "Found X accounts for username 'Y'", then categorized links grouped by platform type.

## Pitfalls

- **No results:** username may not be registered. Suggest checking spelling variations or trying `sherlock "user?name"`.
- **Timeouts:** use `--timeout 120` or `--site` to limit scope.
- **Tor:** requires Tor daemon. If unavailable, suggest `--proxy`.
- **False positives:** some sites always return "found". Cross-reference unexpected results.
- **Rate limiting:** for bulk searches, add delays or use `--local`.

## Ethical Use

Only search usernames the user owns or has permission to investigate. Respect platform ToS. Do not use for harassment, stalking, or illegal activities.
