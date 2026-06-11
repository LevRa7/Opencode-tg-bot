import type { Bot, Context } from "grammy";
import { vi } from "vitest";

interface FakeBotApi {
  sendMessage: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  sendAudio: ReturnType<typeof vi.fn>;
  sendVideo: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  sendChatAction: ReturnType<typeof vi.fn>;
  sendMessageDraft: ReturnType<typeof vi.fn>;
  setMyCommands: ReturnType<typeof vi.fn>;
  createForumTopic: ReturnType<typeof vi.fn>;
  deleteForumTopic: ReturnType<typeof vi.fn>;
  editForumTopic: ReturnType<typeof vi.fn>;
  editGeneralForumTopic: ReturnType<typeof vi.fn>;
}

export function createFakeBotApi(overrides?: Partial<FakeBotApi>): FakeBotApi {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 2 }),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 3 }),
    sendAudio: vi.fn().mockResolvedValue({ message_id: 4 }),
    sendVideo: vi.fn().mockResolvedValue({ message_id: 5 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
    sendChatAction: vi.fn().mockResolvedValue(true),
    sendMessageDraft: vi.fn().mockResolvedValue(true),
    setMyCommands: vi.fn().mockResolvedValue(true),
    createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 100 }),
    deleteForumTopic: vi.fn().mockResolvedValue(true),
    editForumTopic: vi.fn().mockResolvedValue(true),
    editGeneralForumTopic: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

export function createFakeBot(api?: FakeBotApi): Bot<Context> {
  const botApi = api ?? createFakeBotApi();
  return {
    api: botApi,
  } as unknown as Bot<Context>;
}

export function expectSentTo(
  sendMessageMock: ReturnType<typeof vi.fn>,
  expectedChatId: number,
  expectedThreadId?: number,
): void {
  const lastCall = sendMessageMock.mock.calls.at(-1)?.[1];
  expect(lastCall?.chat_id).toBe(expectedChatId);
  if (expectedThreadId !== undefined) {
    expect(lastCall?.message_thread_id).toBe(expectedThreadId);
  }
}
