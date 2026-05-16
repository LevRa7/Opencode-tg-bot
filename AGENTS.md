# AGENTS.md

Instructions for AI agents working on this project.

## About the project

**opencode-telegram-bot** is a Telegram bot that acts as a mobile client for OpenCode.
It lets a user run and monitor coding tasks on a local machine through Telegram.

Functional requirements, features, and development status are in [PRODUCT.md](./PRODUCT.md).

## Technology stack

- **Language:** TypeScript 5.x
- **Runtime:** Node.js 20+
- **Package manager:** npm
- **Configuration:** environment variables (`.env`)
- **Logging:** custom logger with levels (`debug`, `info`, `warn`, `error`)

### Core dependencies

- `grammy` - Telegram Bot API framework (https://grammy.dev/)
- `@grammyjs/menu` - inline keyboards and menus
- `@opencode-ai/sdk` - official OpenCode Server SDK
- `dotenv` - environment variable loading

### Test dependencies

- Vitest
- Mocks/stubs via `vi.mock()`

### Code quality

- ESLint + Prettier
- TypeScript strict mode

## Architecture

### Main components

1. **Bot Layer** - grammY setup, middleware, commands, callback handlers
2. **OpenCode Client Layer** - SDK wrapper and SSE event subscription
3. **State Managers** - session/project/settings/question/permission/model/agent/variant/keyboard/pinned
4. **Summary Pipeline** - event aggregation and Telegram-friendly formatting
5. **Process Manager** - local OpenCode server process start, stop, and status
6. **Runtime/CLI Layer** - runtime mode, config bootstrap, CLI commands
7. **I18n Layer** - localized bot and CLI strings to multiple languages

### Data flow

```text
Telegram User
  -> Telegram Bot (grammY)
  -> Managers + OpenCodeClient
  -> OpenCode Server

OpenCode Server
  -> SSE Events
  -> Event Listener
  -> Summary Aggregator / Tool Managers
  -> Telegram Bot
  -> Telegram User
```

### State management

- Persistent state is stored in `settings.json`.
- Active runtime state is kept in dedicated in-memory managers.
- Session/project/model/agent context is synchronized through OpenCode API calls.
- The app is currently single-user by design.

## AI agent behavior rules

### Communication

- **Response language:** Reply in the same language the user uses in their questions.
- **Clarifications:** If plan confirmation is needed, use the `question` tool. Do not make major decisions (architecture changes, mass deletion, risky changes) without explicit confirmation.

### Git

- **Commits:** Never create commits automatically. Commit only when the user explicitly asks.

### Windows / PowerShell

- Keep in mind the runtime environment is Windows.
- Avoid fragile one-liners that can break in PowerShell.
- Use absolute paths when working with file tools (`read`, `write`, `edit`).

## Coding rules

### Language

- Code, identifiers, comments, and in-code documentation must be in English.
- User-facing Telegram messages should be localized through i18n.

### Code style

- Use TypeScript strict mode.
- Use ESLint + Prettier.
- Prefer `const` over `let`.
- Use clear names and avoid unnecessary abbreviations.
- Keep functions small and focused.
- Prefer `async/await` over chained `.then()`.

### Comments and in-code notes

- Add concise comments when the intent is not obvious from the code itself.
- In production code, explain:
  - what the code does,
  - why this approach was chosen,
  - which constraint or trade-off led to it.
- When fixing code, leave a short note near the change when the fix is subtle:
  - when it was fixed,
  - what caused the issue,
  - what outcome the fix is meant to achieve.
- In tests, document:
  - which function or behavior is being tested,
  - what properties it must satisfy,
  - what result counts as a pass,
  - how the test drives the code path.
- Treat comments as a working notebook for the change: capture the decision, the reason, and the verification path.
- Keep comments short, factual, and useful; do not restate obvious code.
### Error handling

- Use `try/catch` around async operations.
- Log errors with context (session ID, operation type, etc.).
- Send understandable error messages to users.
- Never expose stack traces to users.

### Bot commands

The command list is centralized in `src/bot/commands/definitions.ts`.

```typescript
const COMMAND_DEFINITIONS: BotCommandI18nDefinition[] = [
  { command: "status", descriptionKey: "cmd.description.status" },
  { command: "new", descriptionKey: "cmd.description.new" },
  { command: "abort", descriptionKey: "cmd.description.stop" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "rename", descriptionKey: "cmd.description.rename" },
  { command: "opencode_start", descriptionKey: "cmd.description.opencode_start" },
  { command: "opencode_stop", descriptionKey: "cmd.description.opencode_stop" },
  { command: "help", descriptionKey: "cmd.description.help" },
];
```

Important:

- When adding a command, update `definitions.ts` only.
- The same source is used for Telegram `setMyCommands` and help/docs.
- Do not duplicate command lists elsewhere.

### Logging

The project uses `src/utils/logger.ts` with level-based logging.

Log files:

- Runtime logs are stored in the runtime `logs` directory (`getRuntimePaths().logsDirPath`).
- In source mode this is `<project root>/logs`; if `OPENCODE_TELEGRAM_HOME` is set, use `<OPENCODE_TELEGRAM_HOME>/logs` instead.
- Each source-mode bot run writes to a separate file named `bot-YYYY-MM-DD_HH-MM-SS_<pid>.log`.
- Installed mode writes under the installed app home `logs` directory and uses daily files named `bot-YYYY-MM-DD.log`.
- If a user asks to inspect logs, look in that `logs` directory first and open the newest matching bot log file.

Levels:

- **DEBUG** - detailed diagnostics (callbacks, keyboard build, SSE internals, polling flow)
- **INFO** - key lifecycle events (session/task start/finish, status changes)
- **WARN** - recoverable issues (timeouts, retries, unauthorized attempts)
- **ERROR** - critical failures requiring attention

Use:

```typescript
import { logger } from "../utils/logger.js";

logger.debug("[Component] Detailed operation", details);
logger.info("[Component] Important event occurred");
logger.warn("[Component] Recoverable problem", error);
logger.error("[Component] Critical failure", error);
```

Important:

- Do not use raw `console.log` / `console.error` directly in feature code; use `logger`.
- Put internal diagnostics under `debug`.
- Keep important operational events under `info`.
- Default level is `info`.

## Testing

### What to test

- Unit tests for business logic, formatters, managers, runtime helpers
- Integration-style tests around OpenCode SDK interaction using mocks
- Focus on critical paths; avoid over-testing trivial code

### Test structure

- Tests live in `tests/` (organized by module)
- Use descriptive test names
- Follow Arrange-Act-Assert
- Use `vi.mock()` for external dependencies

## OpenCode SDK quick reference

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk";

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });

await client.global.health();

await client.project.list();
await client.project.current();

await client.session.list();
await client.session.create({ body: { title: "My session" } });
await client.session.prompt({
  path: { id: "session-id" },
  body: { parts: [{ type: "text", text: "Implement feature X" }] },
});
await client.session.abort({ path: { id: "session-id" } });

const events = await client.event.subscribe();
for await (const event of events.stream) {
  // handle SSE event
}
```

Full docs: https://opencode.ai/docs/sdk

## Workflow

1. Read [PRODUCT.md](./PRODUCT.md) to understand scope and status.
2. Inspect existing code before adding or changing components.
3. Align major architecture changes (including new dependencies) with the user first.
4. Add or update tests for new functionality.
5. After code changes, run quality checks: `npm run build`, `npm run lint`, and `npm test`.
6. After the implementation is green, run two review agents in parallel: one security-focused, one architecture-focused.
7. Update `CHANGELOG.md` for any user-visible, functional, or architectural change before finishing the task.
8. Update checkboxes in `PRODUCT.md` when relevant tasks are completed.
9. Keep code clean, consistent, and maintainable.

### DDD guidance

- Prefer explicit domain concepts over primitive obsession. If a value carries domain meaning or invariants, model it as a named object or dedicated type instead of raw `string` / `number` / `boolean`.
- Use ubiquitous language in type names, modules, tests, and comments so the code reflects the business/domain vocabulary.
- Keep value objects immutable and validate invariants at creation time (`factory` / constructor boundary).
- Do not leak Telegram DTOs, OpenCode SDK payloads, env payloads, or storage records into domain/application logic. Map them at the boundary using adapters.
- Keep business rules and invariants in domain/application code, not in handlers, controllers, or framework adapters.
- Introduce value objects only where they reduce ambiguity, encode invariants, or protect a boundary. Do not create abstractions for one-off values.
- Favor bounded-context refactors over repo-wide primitive rewrites. Migrate one context at a time and keep anti-corruption mapping explicit between contexts.
- When reviewing a change, check whether public signatures still expose meaningless primitives where a domain concept now exists.

### Preferred review skills and when to use them

- `code-reviewer` — default post-change review for correctness, tests, and maintainability.
- `security-auditor` — security-sensitive code, auth, secrets, input handling, trust boundaries, and remote-control surfaces.
- `threat-modeling-expert` — permission flow, abuse scenarios, and attack-surface review when the bot can trigger actions in other systems.
- `architect-review` — complexity, module boundaries, coupling, scalability, debuggability, DDD boundaries, and Clean Architecture dependency direction.
- `architecture-patterns` — when the review should explicitly evaluate layering, ports/adapters, and anti-corruption boundaries.
- `prompt-engineer` / `prompt-engineering-patterns` — crafting clearer, stricter agent instructions.
- `tdd-orchestrator` — when the task should follow a strict test-first workflow.
- `unit-testing-test-generate` + `test-automator` — when a dedicated worker should write or expand tests under TDD guidance.
- `context-driven-development` — when a change needs bounded-context modeling and ubiquitous language alignment before coding.
- `agent-orchestration-multi-agent-optimize` — when coordinating parallel review agents.

### Recommended agent roles for substantial changes

- **DDD / Context Lead** — model bounded contexts, glossary, and domain boundaries before code changes.
- **TDD Orchestrator** — enforce Red-Green-Refactor and define the test sequence before implementation.
- **Test Engineer** — write or expand unit, integration, and contract tests under TDD guidance.
- **Security Reviewer** — review remote-control flows, permission boundaries, and abuse paths.
- **Architecture Reviewer** — review DDD boundaries, Clean Architecture dependency direction, and maintainability.

### Post-implementation review prompt template

Use this structure after tests and code are complete:

1. Brief context: what changed and why.
2. Exact scope: list the touched files and the behavior that changed.
3. Verification: state which tests or commands already passed.
4. Review focus: tell each agent exactly what to look for.
5. Output format: require file:line references, severity, why it matters, and the smallest useful fix.
6. Run the review agents in parallel, not sequentially, so security and architecture feedback arrive independently.
7. If the change introduces or reshapes domain concepts, ask the architecture reviewer to evaluate DDD boundaries and Clean Architecture dependency direction explicitly.

#### Security review prompt

```text
Review these changes for security issues only.

Focus on authn/authz, secrets handling, input validation, injection, SSRF, path traversal, unsafe deserialization, race conditions, logging leaks, privilege escalation, and remote-control abuse paths.
Pay extra attention to trust boundaries where the Telegram bot can trigger actions in local runtimes or external tools.

For each finding, report: severity, file:line, why it matters, exploitability, and the smallest safe fix.
If there are no findings, say so and mention any residual risk.
Do not suggest unrelated refactors.
```

#### Architecture review prompt

```text
Review these changes for architecture and complexity quality.

Focus on coupling, cohesion, module boundaries, DDD bounded contexts, ubiquitous language, dependency direction, Clean Architecture layering, testability, observability, debuggability, scalability, and how hard it would be to replace one module with another.
Call out trade-offs, hotspots, hidden dependencies, and places where primitives leak across domain boundaries.
For each finding, report: severity, file:line, why it matters, and the smallest refactor that would improve the design.
Keep the focus on maintainability, not style.
```

#### Combined prompt for implementation follow-up

```text
You are reviewing the implementation after tests and code changes have already passed locally.

Context:
- Summarize what changed in 1-3 sentences.
- List the touched files.
- Mention which checks already passed.

Review goals:
1. Security reviewer: inspect only security risks.
2. Architecture reviewer: inspect only design, complexity, scalability, and debuggability.

For every finding, include:
- severity
- file:line
- why it matters
- the smallest useful fix

If nothing is found, say that explicitly and mention any residual risk or follow-up watchpoints.
Do not repeat the implementation summary in the findings section.
```

## TDD Development Approach

### Overview

TDD (Test-Driven Development) is a disciplined approach where tests are written **before** implementation code. This ensures that code is always tested and that design emerges from requirements.

### The Red-Green-Refactor Cycle

```
┌─────────────────────────────────────────────────────────────┐
│  1. RED     → Write a failing test                         │
│  2. GREEN    → Write minimal code to pass the test          │
│  3. REFACTOR → Clean up code while keeping tests green     │
└─────────────────────────────────────────────────────────────┘
```

### Workflow: Problem → Plan → Tests → Code → Verification

#### 1. Problem Understanding
- Understand the requirement fully before writing any code
- Identify inputs, outputs, and edge cases
- Ask clarifying questions if needed

#### 2. Plan
- Break down the feature into small, testable units
- Define the expected behavior for each unit
- Prioritize simple cases before complex ones

#### 3. Write Tests First
```typescript
// BAD: Write code first, then test
function calculateDiscount(price: number): number {
  return price * 0.1; // Implementation without test
}

// GOOD: Write test first
describe("calculateDiscount", () => {
  it("should return 10% discount for regular price", () => {
    expect(calculateDiscount(100)).toBe(10);
  });
  
  it("should return 0 for zero price", () => {
    expect(calculateDiscount(0)).toBe(0);
  });
  
  it("should throw for negative price", () => {
    expect(() => calculateDiscount(-10)).toThrow();
  });
});
```

#### 4. Implement Minimal Code
- Write only enough code to make the test pass
- Do not add "nice-to-have" features (YAGNI - You Aren't Gonna Need It)
- Focus on the happy path first

#### 5. Verify & Refactor
- Ensure all tests pass
- Clean up code while keeping tests green
- Remove duplication (DRY - Don't Repeat Yourself)

### Principles from "Clean Code" (Robert C. Martin)

| Principle | Description |
|-----------|-------------|
| **Meaningful Names** | Variables, functions, and classes should reveal intent |
| **Small Functions** | Functions should do one thing, do it well, and do it only |
| **Single Responsibility** | Each class/module has one reason to change |
| **Tell, Don't Ask** | Don't query objects for state, then make decisions |
| **Law of Demeter** | Only talk to immediate friends |
| **Error Handling** | Handle errors explicitly; prefer exceptions over return codes |

### Principles from "Clean Architecture" (Robert C. Martin)

```
┌────────────────────────────────────────────────────────────┐
│                    Presentation Layer                      │
│              (Controllers, UI, Gateways, Presenters)       │
├────────────────────────────────────────────────────────────┤
│                    Application Layer                        │
│                    (Use Cases, Interactors)                │
├────────────────────────────────────────────────────────────┤
│                      Domain Layer                           │
│                    (Entities, Business Rules)               │
├────────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                      │
│              (Frameworks, DB, External Services)            │
└────────────────────────────────────────────────────────────┘
```

| Principle | Application |
|-----------|-------------|
| **Dependency Rule** | Dependencies point inward; inner layers know nothing about outer layers |
| **Stable Abstractions** | High-level policies should not depend on low-level details |
| **Concrete vs Abstract** | Depend on abstractions, not concretions |
| **Boundaries** | Separate things that change for different reasons |

### Test Requirements

#### What to Test

| Priority | What to Test | Why |
|----------|--------------|-----|
| Critical | Business logic, calculations, transformations | Core functionality must work |
| Critical | Edge cases, boundary conditions | Prevents bugs in production |
| High | Error handling paths | System fails gracefully |
| Medium | Integration points (with mocks) | Contract verification |
| Low | Trivial getters/setters | Usually not worth testing |

#### How to Name Tests

Use the pattern: `describe("[Unit]").it("[Expected behavior] [when condition]")`

```typescript
describe("OrderService", () => {
  describe("calculateTotal", () => {
    it("should sum all item prices when order is valid");
    it("should apply discount when customer has loyalty status");
    it("should throw ValidationError when order is empty");
    it("should return 0 when all items have zero price");
  });
});
```

#### Test Patterns

**Arrange-Act-Assert (AAA):**
```typescript
it("should send notification when order is placed", async () => {
  // Arrange
  const order = createTestOrder({ status: "pending" });
  const notifier = new SpyNotifier();
  const service = new OrderService(notifier);
  
  // Act
  await service.placeOrder(order);
  
  // Assert
  expect(notifier.sent).toHaveLength(1);
  expect(notifier.sent[0].type).toBe("order_placed");
});
```

**Given-When-Then (BDD style):**
```typescript
describe("ShoppingCart", () => {
  describe("when adding an item", () => {
    given("an empty cart", () => {
      const cart = new ShoppingCart();
      
      when("adding a product", () => {
        cart.add(product);
        
        then("cart should contain one item", () => {
          expect(cart.items).toHaveLength(1);
        });
      });
    });
  });
});
```

### Refactoring Rules

#### The Three Laws of TDD (Uncle Bob)

1. **You must write a failing test before writing any production code**
2. **You must not write more of a test than is sufficient to fail**
3. **You must not write more production code than is sufficient to pass the failing test**

#### Safe Refactoring Checklist

- [ ] All tests are green before starting
- [ ] Make small, incremental changes
- [ ] Run tests after each change
- [ ] If a test breaks, you either introduced a bug or misunderstood the test
- [ ] Never modify a test to make production code pass
- [ ] If refactoring is needed, do it in the Refactor phase, not during Green phase

#### Code Smells to Address

| Smell | Description | Fix |
|-------|-------------|-----|
| **Duplication** | Same code appears in multiple places | Extract to shared function |
| **Long Function** | Function does too many things | Split into smaller functions |
| **Large Class** | Class has too many responsibilities | Extract smaller classes |
| **Shotgun Surgery** | One change requires many modifications | Find the missing abstraction |
| **Primitive Obsession** | Overuse of primitives over small objects | Create value objects |

### Best Practices Summary

- **Test behavior, not implementation** - Tests should not break when internal implementation changes
- **One assertion per test** (preferred) or logical groups of assertions
- **Tests should be fast** - Slow tests won't be run frequently
- **Tests must be deterministic** - No flaky tests; same result every time
- **Independent tests** - Each test can run in isolation
- **Clean test code** - Tests are production code; maintain the same quality

---

## Docker container utilities

### AGENTS.md merge system

The container merges multiple instruction sources into a single effective `AGENTS.md` at startup.

**Sources (priority order, later overrides earlier):**

| Source | Path in container | Description |
|--------|-------------------|-------------|
| User global | `/etc/opencode/AGENTS.md` | Volume-mounted from `~/.config/opencode/AGENTS.md` on host |
| Project global | `/etc/opencode-global/AGENTS.md` | Baked into image from `docker/AGENTS.md` in repo |
| Project local | `/workspace/AGENTS.md` | User's project-specific instructions, loaded separately by OpenCode |

**How it works:**
- At container startup, `docker-entrypoint.sh` runs `merge-agents` before launching OpenCode
- `merge-agents` combines only the two global layers into `/state/config/opencode/AGENTS.md`
- OpenCode reads that file as its global instructions path via `XDG_CONFIG_HOME`
- `/workspace/AGENTS.md` remains a separate project-local instruction file and is loaded by OpenCode directly
- Changes to `~/.config/opencode/AGENTS.md` on the host take effect on next container restart
- To update global instructions for all tenants, edit `docker/AGENTS.md` and rebuild the image

### Whisper STT batch transcription

The container includes scripts for batch-transcribing voice messages (`.ogg`) and video circles (`.mp4`) using the Whisper STT API.

**Environment variables** (set in container or via `docker exec -e`):

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_API_URL` | `http://192.168.2.166:1488/v1` | Whisper API endpoint |
| `STT_API_KEY` | _(required)_ | API authentication key |
| `STT_MODEL` | `medium` | Whisper model name |
| `STT_LANGUAGE` | `ru` | Target language code |
| `BATCH_SIZE` | `10` | Parallel transcription jobs |

**Usage:**

```bash
# Bash version (recommended, uses curl + parallel jobs)
docker exec -it <container> batch-transcribe /path/to/audio/dir

# Node.js version (Promise.all batching)
docker exec -it <container> batch-transcribe-node /path/to/audio/dir

# With custom batch size
docker exec -it -e BATCH_SIZE=5 <container> batch-transcribe /path/to/audio/dir
```

**Behavior:**
- Recursively scans the target directory for `.ogg` and `.mp4` files
- Skips files that already have a `.transcribed.txt` result
- Writes transcription output to `<filename>.transcribed.txt` next to the source
- Processes files in parallel batches (default: 10 concurrent jobs)
- Exits with code 1 if any transcriptions failed

---

### References

- [Superpowers TDD Skill](https://github.com/obra/superpowers) - Agentic skills framework for TDD workflow
- [Clean Code](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882) - Robert C. Martin
- [Clean Architecture](https://www.amazon.com/Clean-Architecture-Craftsmans-Software-Structure/dp/0132350882) - Robert C. Martin
