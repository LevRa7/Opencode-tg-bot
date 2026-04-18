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
