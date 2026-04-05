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
6. Update checkboxes in `PRODUCT.md` when relevant tasks are completed.
7. Keep code clean, consistent, and maintainable.

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

### References

- [Superpowers TDD Skill](https://github.com/obra/superpowers) - Agentic skills framework for TDD workflow
- [Clean Code](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882) - Robert C. Martin
- [Clean Architecture](https://www.amazon.com/Clean-Architecture-Craftsmans-Software-Structure/dp/0132350882) - Robert C. Martin
