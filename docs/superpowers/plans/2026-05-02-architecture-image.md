# Architecture Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a cyberpunk-themed architectural diagram for the OpenCode-Telegram Bot project and save it to the repository.

**Architecture:** We will use the local `gpt-image-api` skill to generate an image based on the finalized cyber-noir/cyberpunk prompt from the specification. The generated image will then be reviewed, moved to an appropriate assets folder in the repository, and linked or displayed to the user.

**Tech Stack:** `gpt-image-api` skill (local Node.js service), filesystem operations.

---

### Task 1: Generate the Architecture Image

**Files:**

- Create: `assets/architecture-cyberpunk.png` (or similar, output from the API)

- [ ] **Step 1: Check `gpt-image-api` availability**

Run the `gpt-image-api` skill to ensure we have access to the generation capability.
Command: We will dispatch a subagent or run inline to use the skill tool `gpt-image-api`. The skill instructs how to call the local Node.js endpoint.

- [ ] **Step 2: Execute the generation request**

Use the exact Base Prompt from the spec to request the image generation via the local API.

Base Prompt:
`A highly detailed, cinematic cyberpunk architectural diagram. Dark techno-noir background. A massive glowing cloud structure (Telegram API) sends neon blue data streams to a central, fortified server hub (Bot). The hub connects to a secure underground vault (Docker/Local Server) via armored cables. Feature "fragile" error moments: A red glowing forcefield blocking data with a yellow "retry" loop catching packets; isolated glass tubes separating data threads with one locked by a glowing shield; a sparking, severed cable to the vault being actively repaired by a green "auto-restart" laser. Neon lighting, glowing circuits, isometric perspective, high tech, intricate details, 8k resolution, Unreal Engine 5 render style.`

- [ ] **Step 3: Save and locate the output**

Wait for the API to return the generated image path (it usually saves to a specific local directory or returns a URL).

- [ ] **Step 4: Move the image to the project assets folder**

If the image is not already in the project's asset directory, copy or move it.

```bash
mkdir -p /home/me/MyProjects/opencode-tg/assets
cp <path-to-generated-image> /home/me/MyProjects/opencode-tg/assets/architecture-cyberpunk.png
```

- [ ] **Step 5: Verify the file exists**

```bash
ls -la /home/me/MyProjects/opencode-tg/assets/architecture-cyberpunk.png
```

- [ ] **Step 6: Commit the image**

```bash
git add /home/me/MyProjects/opencode-tg/assets/architecture-cyberpunk.png
git commit -m "docs: add cyberpunk architecture diagram"
```

### Task 2: Update Documentation to Include the Image

**Files:**

- Modify: `docs/architecture.md` (or create if it doesn't exist, or just `README.md` if preferred)

- [ ] **Step 1: Check for existing architecture documentation**

```bash
ls -la /home/me/MyProjects/opencode-tg/docs/architecture.md
```

- [ ] **Step 2: Append the image link to the documentation**

Add the markdown image link `![OpenCode-Telegram Cyberpunk Architecture](../assets/architecture-cyberpunk.png)` to the top or relevant section of the architecture document.

If modifying `docs/architecture.md`:
Use the `Edit` tool or `Write` tool (if new) to insert the image reference.

- [ ] **Step 3: Commit the documentation update**

```bash
git add /home/me/MyProjects/opencode-tg/docs/architecture.md
git commit -m "docs: embed cyberpunk architecture diagram in docs"
```
