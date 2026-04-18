# Docker Gemma4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `local/gemma4` available only in the vendored Docker OpenCode client without changing the non-Docker runtime.

**Architecture:** The Docker runtime reads available providers and models from the vendored OpenCode package under `docker/opencode-client-src/packages/opencode`. The minimal change is to extend the bundled provider snapshot with a Docker-only `local` provider and verify that `Provider.list()` exposes the new model with the expected base URL and multimodal capabilities.

**Tech Stack:** TypeScript, Bun test runner, vendored OpenCode provider snapshot, OpenAI-compatible provider integration

---

## File Structure

- Modify: `docker/opencode-client-src/packages/opencode/src/provider/models-snapshot.js`
  - Add the Docker-only `local` provider entry and `gemma4` model metadata.
- Modify: `docker/opencode-client-src/packages/opencode/test/provider/provider.test.ts`
  - Add a focused regression test that asserts the bundled snapshot exposes `local/gemma4` with the expected `baseURL`, limits, and image input support.
- Modify: `CHANGELOG.md`
  - Record the Docker-visible model addition and why it affects only the vendored Docker runtime.

### Task 1: Add a Failing Regression Test for the Docker Bundled Provider

**Files:**

- Modify: `docker/opencode-client-src/packages/opencode/test/provider/provider.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test near the other provider-loading tests:

```ts
test("bundled docker snapshot exposes local gemma4 provider", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      );
    },
  });
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list();
      const provider = providers[ProviderID.make("local")];

      expect(provider).toBeDefined();
      expect(provider.source).toBe("custom");
      expect(provider.name).toBe("Local Gemma4");
      expect(provider.models["gemma4"]).toBeDefined();
      expect(provider.models["gemma4"].api.npm).toBe("@ai-sdk/openai-compatible");
      expect(provider.models["gemma4"].api.url).toBe("http://192.168.2.166:18080/v1");
      expect(provider.models["gemma4"].limit.context).toBe(128000);
      expect(provider.models["gemma4"].limit.output).toBe(32000);
      expect(provider.models["gemma4"].capabilities.attachment).toBe(true);
      expect(provider.models["gemma4"].capabilities.input.image).toBe(true);
      expect(provider.models["gemma4"].capabilities.output.text).toBe(true);
    },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test test/provider/provider.test.ts
```

from:

```bash
docker/opencode-client-src/packages/opencode
```

Expected: FAIL because `providers[ProviderID.make("local")]` is undefined before the snapshot change.

- [ ] **Step 3: Commit the red test checkpoint**

```bash
git add docker/opencode-client-src/packages/opencode/test/provider/provider.test.ts
git commit -m "test: cover docker local gemma4 provider"
```

### Task 2: Add the Docker-Only Provider Snapshot Entry

**Files:**

- Modify: `docker/opencode-client-src/packages/opencode/src/provider/models-snapshot.js`

- [ ] **Step 1: Add the minimal provider entry**

Insert a new top-level provider in the exported snapshot:

```js
  local: {
    id: "local",
    env: [],
    npm: "@ai-sdk/openai-compatible",
    api: "http://192.168.2.166:18080/v1",
    name: "Local Gemma4",
    models: {
      gemma4: {
        id: "gemma4",
        name: "Gemma 4 26b",
        attachment: true,
        reasoning: false,
        tool_call: false,
        release_date: "2026-04-16",
        last_updated: "2026-04-16",
        modalities: { input: ["text", "image"], output: ["text"] },
        open_weights: true,
        cost: { input: 0, output: 0 },
        limit: { context: 128000, output: 32000 },
      },
    },
  },
```

Notes for the implementer:

- The bundled snapshot provider shape uses top-level `api` and `npm`, not nested `options.baseURL`.
- `Provider.fromModelsDevModel()` maps provider `api` to `model.api.url`, so this is the correct place to encode the Docker endpoint.
- Keep the change Docker-scoped by editing only the vendored snapshot file.

- [ ] **Step 2: Run the targeted test to verify it passes**

Run:

```bash
bun test test/provider/provider.test.ts
```

from:

```bash
docker/opencode-client-src/packages/opencode
```

Expected: PASS, including the new `bundled docker snapshot exposes local gemma4 provider` test.

- [ ] **Step 3: Commit the green implementation checkpoint**

```bash
git add docker/opencode-client-src/packages/opencode/src/provider/models-snapshot.js docker/opencode-client-src/packages/opencode/test/provider/provider.test.ts
git commit -m "feat: add docker local gemma4 model"
```

### Task 3: Update Project-Level Change Tracking

**Files:**

- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the changelog entry**

Add an item under `## [Unreleased]` and `### Changed`:

```md
- Added a Docker-only bundled `local/gemma4` model entry to the vendored OpenCode provider snapshot.
  - Why: Docker users need the local Gemma 4 endpoint to appear in the model picker without changing the non-Docker runtime configuration.
  - Affects: `docker/opencode-client-src/packages/opencode/src/provider/models-snapshot.js`, `docker/opencode-client-src/packages/opencode/test/provider/provider.test.ts`
```

- [ ] **Step 2: Run the smallest full verification for the touched area**

Run:

```bash
bun test test/provider/provider.test.ts && bun typecheck
```

from:

```bash
docker/opencode-client-src/packages/opencode
```

Expected: both commands pass.

- [ ] **Step 3: Commit the documentation checkpoint**

```bash
git add CHANGELOG.md
git commit -m "docs: record docker gemma4 availability"
```

## Self-Review

- Spec coverage: the plan covers the Docker-only provider addition, leaves non-Docker config untouched, and includes verification against the vendored provider loader.
- Placeholder scan: no `TODO`, `TBD`, or implicit test steps remain.
- Type consistency: the plan uses the actual vendored provider shapes (`api`, `npm`, `source: "custom"`) and existing test helpers (`tmpdir`, `Instance.provide`, `Provider.list`, `ProviderID.make`).
