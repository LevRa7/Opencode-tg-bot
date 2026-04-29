---
name: gpt-image-api
description: Use when generating images from a prompt or editing images with one to five reference images through the container-provided GPT image helper.
---

# GPT Image API

Use `/usr/local/bin/opencode-gpt-image` for image generation in this Docker workspace. Relative output names are written under `/workspace`, and the helper prints the absolute PNG path after writing the file.

## Commands

Prompt only:

```bash
/usr/local/bin/opencode-gpt-image generate "prompt text" output.png
```

Prompt plus references:

```bash
/usr/local/bin/opencode-gpt-image edit input.png ref1.png [ref2.png ref3.png ref4.png ref5.png] -- "edit prompt" output.png
```

## Rules

- Always use `/usr/local/bin/opencode-gpt-image`, not ad-hoc HTTP requests.
- Do not read, create, or request `.env` files for this tool.
- Do not store or print upstream API URLs or keys.
- Verify output with `file <path>` before final response.
- Final response must include the full absolute path returned by the helper.
- Prefer relative output names like `result.png`; the helper will place them in `/workspace`.
- If generation fails or `file` does not report `PNG image data`, say no valid PNG was produced and do not invent a path.
- For reference edits, pass the base image and 1-5 references before `--`; pass prompt and output after `--`.

## Examples

```bash
/usr/local/bin/opencode-gpt-image generate "динозавр на луне" dinosaur-on-moon.png
file /workspace/dinosaur-on-moon.png
```

Final response:

```text
/workspace/dinosaur-on-moon.png
```

```bash
/usr/local/bin/opencode-gpt-image edit base.png ref1.png ref2.png -- "replace the background using the references" edited-with-refs.png
file /workspace/edited-with-refs.png
```

Final response:

```text
/workspace/edited-with-refs.png
```

## Common Mistakes

| Mistake | Fix |
|---|---|
| Returning a relative path | Return the absolute path printed by the helper. |
| Making direct requests to the upstream endpoint | Use `/usr/local/bin/opencode-gpt-image`. |
| Looking for `.env` | The proxy is preconfigured; users cannot access upstream credentials. |
| Putting references after `--` | Put references before `--`; only prompt/output go after it. |
