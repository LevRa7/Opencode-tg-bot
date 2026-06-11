/**
 * Test utilities for routing tests.
 */

/**
 * Creates a unique session ID for test isolation.
 */
export function uniqueSessionId(prefix = "ses_test"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Creates a minimal TelegramConversationScope.
 */
export function makeScope(
  userId: number,
  chatId: number,
  messageThreadId?: number,
) {
  return { userId, chatId, messageThreadId };
}

/**
 * Creates a minimal routing target.
 */
export function makeTarget(chatId: number, messageThreadId?: number) {
  return { chatId, messageThreadId };
}

/**
 * Asserts that a mock function was called exactly once.
 */
export function expectCalledOnce(mock: { mock: { calls: { length: number } } }): void {
  expect(mock.mock.calls.length).toBe(1);
}

/**
 * Asserts that a mock function was not called.
 */
export function expectNotCalled(mock: { mock: { calls: { length: number } } }): void {
  expect(mock.mock.calls.length).toBe(0);
}
