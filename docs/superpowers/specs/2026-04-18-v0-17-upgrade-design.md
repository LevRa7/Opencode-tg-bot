# v0.17.0 Upgrade Design

## Context

The current workspace is not a clean upstream `v0.14.1` checkout.
It already contains substantial local behavior that must remain authoritative during the upgrade:

- multi-user orchestration
- new-user approval flow
- threaded/forum delivery and routing behavior
- Docker/runtime customizations
- local streaming and response-finalization fixes

Upstream `grinev/opencode-telegram-bot` changed significantly between `v0.14.1` and `v0.17.0`.
The compare contains 137 changed files and several architectural hotspots:

- `src/bot/index.ts`
- response streaming and finalization
- Telegram rendering pipeline
- runtime/bootstrap and service/process management
- project/session routing and pinned status handling
- new bot commands such as `/open`, `/skills`, `/worktree`, `/tts`

Because the local branch already diverged materially from upstream, a blind file replacement or direct merge would risk silently breaking domain-specific behavior that matters more than textual parity with upstream.

## Goal

Upgrade the project to functional `v0.17.0` compatibility while preserving local customizations that are already shipped in this branch.

This means:

- update the project version to `0.17.0`
- port the useful upstream changes introduced between `v0.14.1` and `v0.17.0`
- keep local behavior for multi-user orchestration, user approvals, threaded mode, and Docker/runtime flows intact
- avoid taking upstream refactors wholesale when they conflict with those local requirements

## Non-Goal

This upgrade does not require byte-for-byte alignment with upstream `v0.17.0` internals.
The target is behavioral and release-level compatibility, not a mechanically identical source tree.

## Chosen Approach

Use a semantic port on top of the current branch.

This approach treats upstream `v0.17.0` as a source of features, fixes, and architectural ideas, but not as the source of truth for every conflicting file.
The current branch remains the primary baseline, and upstream changes are imported subsystem by subsystem.

Why this approach was chosen:

- it minimizes the chance of losing local behavior in `bot/index`, routing, runtime, and approvals
- it allows test-first protection for the most fragile local invariants
- it keeps the upgrade incremental, observable, and reversible at subsystem boundaries

Rejected approaches:

- direct merge/rebase from upstream `v0.17.0`
  - too likely to create broad conflicts in `bot/index`, routing, runtime, and stream delivery
- clean reset to upstream `v0.17.0` plus re-applying local changes
  - too expensive and too risky for already-diverged multi-user and threaded behavior

## Migration Strategy

The upgrade is split into controlled blocks.
Each block is allowed to complete only after the relevant verification passes.

### Block A: Baseline Protection

Protect current local behavior with tests before porting upstream logic.

The baseline protection must cover at least:

- multi-user routing boundaries
- new-user approval flow
- threaded/forum routing and delivery
- reasoning/thinking behavior
- final response delivery after streaming
- Docker/runtime behaviors that are already intentionally customized

This block exists to make later upstream adoption safe.

### Block B: Version, Config, and Low-Risk Metadata

Port low-risk upstream changes that do not challenge local architecture:

- `package.json` version update to `0.17.0`
- dependency updates needed by the upstream Telegram rendering pipeline
- `.env.example` and documentation additions that still fit the local branch
- i18n and command metadata updates where they do not conflict with local command policy

These changes are expected to be mostly mechanical.

### Block C: Rendering and Streaming

Port the most valuable upstream presentation changes, but adapt them to the local routing model.

Expected focus:

- Telegram rendering pipeline improvements
- streaming/finalization fixes
- improved chunking and final reply handling
- better tool/reasoning presentation

Critical constraint:

The upstream rendering/streaming code must be integrated on top of the local session/thread routing guarantees instead of replacing them.

### Block D: New Commands and Utilities

Evaluate and port the upstream command additions selectively:

- `/skills`
- `/worktree`
- `/open`
- `/tts`

Each command must be reviewed against local permissions, multi-user behavior, and runtime assumptions before adoption.

### Block E: Runtime, Process, and Service Refactors

This is the highest-risk block.

Upstream contains substantial runtime and service/process restructuring between `v0.14.1` and `v0.17.0`.
These changes must not be imported wholesale.

Rules for this block:

- adopt only pieces that improve the current branch without breaking local multi-user or Docker behavior
- keep the existing local runtime model when it is already serving branch-specific requirements better than upstream
- prefer narrow ports over broad structural rewrites

### Block F: Final Consolidation

After subsystem ports are complete:

- update project docs and release tracking
- ensure command registry and help text remain coherent
- run full verification
- document any upstream pieces that were consciously skipped

## Decision Rules For Upstream Code

Each upstream change must be categorized explicitly.

### Take As-Is

Use only for isolated upstream changes that do not intersect with:

- multi-user behavior
- user approvals
- threaded routing
- Docker/runtime customizations
- session-scoped streaming/finalization logic

### Adapt

Use for any upstream change that touches architectural hotspots, especially:

- `src/bot/index.ts`
- handlers and routing
- session/project/thread context
- pinned status updates
- streaming/final response delivery
- runtime/service/process orchestration
- permission and auth-adjacent flows

These changes are expected to be rewritten to fit the local branch rather than copied verbatim.

### Skip

Skip upstream changes when they:

- do not contribute meaningfully to the `v0.17.0` release value for this branch
- duplicate or conflict with better local behavior already present
- require a large architectural rollback of local branch requirements

Skipped items are not considered accidental omissions.
They must be documented as deliberate exclusions.

## Architecture Rule

During the upgrade, local domain behavior takes priority over upstream implementation shape.

In practice:

- local multi-user orchestration remains authoritative
- local approval and allowlist behavior remains authoritative
- local threaded/forum routing remains authoritative
- Docker/runtime customizations remain authoritative unless an upstream change can be proven compatible

Upstream code is allowed to improve these flows, but not to erase them.

## Success Criteria

The upgrade is successful when all of the following are true:

- the project reports version `0.17.0`
- key upstream improvements from `v0.14.1..v0.17.0` that matter to this branch are ported
- the local branch still preserves:
  - multi-user orchestration
  - new-user approval flow
  - threaded/forum mode behavior
  - Docker/runtime custom behavior
- no critical regression is introduced in streaming, final delivery, routing, or permissions
- full verification passes:
  - `npm run build`
  - `npm run lint`
  - `npm test`

If any meaningful upstream area is intentionally not ported, the final result must say so explicitly.

## Verification Strategy

Verification must happen incrementally and at the end.

Minimum expected gates:

- targeted tests before each risky port
- focused subsystem verification after each block
- final full-project verification with build, lint, and test

No high-risk subsystem port should be treated as complete without evidence from passing checks.

## Expected Outcome

The resulting branch will be a locally customized `0.17.0`-level release line.
It will include the useful upstream changes from `v0.14.1..v0.17.0`, while preserving the local branch's more advanced user, routing, and Docker/runtime behavior.
