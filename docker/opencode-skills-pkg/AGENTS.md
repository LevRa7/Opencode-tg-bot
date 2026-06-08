## OpenCode Skill System

This package converts Hermes Agent skills into OpenCode-compatible instructions.

### How it differs from Hermes

| Aspect | Hermes | OpenCode |
|--------|--------|----------|
| Skill format | `SKILL.md` with YAML frontmatter | Plain instructions in `AGENTS.md` or loaded via skill tool |
| Skill storage | `~/.hermes/skills/<name>/SKILL.md` | Loaded at session start via system prompt or `skill` tool |
| Memory | Built-in + 8 plugin providers (Honcho, Mem0, etc.) | No persistent memory system — all context is session-scoped |
| Plugin system | Python plugins with lifecycle hooks | No plugin system — uses tools natively |
| MCP | Native MCP client | MCP servers via config |
| Skill hub | 89k skills in centralized index | No hub — skills are local AGENTS.md entries |
| Dependency mgmt | Declared in SKILL.md frontmatter | Inline in skill instructions |

### How to use these skills

**Method 1: Load via skill tool (recommended)**
Each skill directory contains a plain `.md` file. Load it when needed:
```
Use the skill tool to load `<category>/<skill-name>` from the package.
```

**Method 2: AGENTS.md integration**
Copy relevant skill instructions into your project's `AGENTS.md`.
Skills are organized by category in `registry/catalog.json`.

**Method 3: Installer**
Run `bash install.sh <category>/<skill-name>` to:
1. Print the skill instructions
2. Install system dependencies (apt)
3. Install Python packages (pip)
4. Install Node.js packages (npm)
5. Configure required environment variables

### Memory adaptation (Hermes → OpenCode)

Hermes has a sophisticated memory system (MEMORY.md/USER.md + plugin providers).
OpenCode has none of this. Adaptation strategy:

1. **Durable facts** → Store in project files, git-committed config
2. **User preferences** → Store in `settings.json` or env vars
3. **Cross-session knowledge** → Not supported; each session is stateless
4. **Session context** → Use the built-in context window only

If you need persistent memory across sessions, implement it manually:
- `~/.config/opencode/memory.json` for facts
- `~/.config/opencode/preferences.json` for user settings

### Hermes-specific skills adaptation

Skills referencing Hermes internals (`hermes_state.py`, `hermes_cli.*`, etc.)
are NOT directly usable in OpenCode. They are included as reference only:
- `hermes-agent-config` — Hermes documentation, not applicable
- `hermes-s6-container-supervision` — Docker/s6 architecture, port manually
- `hermes-agent-skill-authoring` — SKILL.md format reference, adapt to OpenCode

### Available skills

Full catalog in `registry/catalog.json`. Quick overview:
- 90+ skills across 24 categories
- Each includes: description, dependencies, env vars, setup guide
- Zero-install skills (stdlib only): `osint-investigation`, `concept-diagrams`, `one-three-one-rule`, `watchers`
- Heavy skills (GPU/data): `whisper`, `torchtitan`, `clip`, `chroma`, `bioinformatics`
