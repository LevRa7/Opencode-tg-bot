interface SummaryAggregatorPrivateState {
  onCompleteCallback: null;
  onPartialCallback: null;
  onToolCallback: null;
  onToolFileCallback: null;
  onQuestionCallback: null;
  onQuestionErrorCallback: null;
  onThinkingCallback: null;
  onTokensCallback: null;
  onSessionCompactedCallback: null;
  onSessionErrorCallback: null;
  onPermissionCallback: null;
  onSessionDiffCallback: null;
  onFileChangeCallback: null;
  bot: null;
  chatId: null;
  typingIndicatorEnabled: boolean;
  resolveSessionDirectory: (sessionId: string) => string | null;
}

interface KeyboardManagerPrivateState {
  scopedStates: Map<string, unknown>;
}

interface PinnedMessageManagerPrivateState {
  scopedRuntimes: Map<string, { updateDebounceTimer: ReturnType<typeof setTimeout> | null }>;
  onKeyboardUpdateCallback: undefined;
}

interface ProcessManagerPrivateState {
  state: {
    process: null;
    pid: null;
    startTime: null;
    isRunning: boolean;
  };
}

export async function resetSingletonState(): Promise<void> {
  const [
    { questionManager },
    { permissionManager },
    { renameManager },
    { interactionManager },
    { summaryAggregator },
    keyboardModule,
    pinnedModule,
    { processManager },
    { stopEventListening },
    { __resetSessionDirectoryCacheForTests },
  ] = await Promise.all([
    import("../../src/question/manager.js"),
    import("../../src/permission/manager.js"),
    import("../../src/rename/manager.js"),
    import("../../src/interaction/manager.js"),
    import("../../src/summary/aggregator.js"),
    import("../../src/keyboard/manager.js"),
    import("../../src/pinned/manager.js"),
    import("../../src/process/manager.js"),
    import("../../src/opencode/events.js"),
    import("../../src/session/cache-manager.js"),
  ]);

  stopEventListening();
  questionManager.clear();
  permissionManager.clear();
  renameManager.clear();
  interactionManager.clear("test_reset");
  summaryAggregator.clear();

  const aggregator = summaryAggregator as unknown as SummaryAggregatorPrivateState;
  aggregator.onCompleteCallback = null;
  aggregator.onPartialCallback = null;
  aggregator.onToolCallback = null;
  aggregator.onToolFileCallback = null;
  aggregator.onQuestionCallback = null;
  aggregator.onQuestionErrorCallback = null;
  aggregator.onThinkingCallback = null;
  aggregator.onTokensCallback = null;
  aggregator.onSessionCompactedCallback = null;
  aggregator.onSessionErrorCallback = null;
  aggregator.onPermissionCallback = null;
  aggregator.onSessionDiffCallback = null;
  aggregator.onFileChangeCallback = null;
  aggregator.bot = null;
  aggregator.chatId = null;
  aggregator.typingIndicatorEnabled = true;
  aggregator.resolveSessionDirectory = () => null;

  const keyboard = keyboardModule.keyboardManager as unknown as KeyboardManagerPrivateState;
  if (keyboard && keyboard.scopedStates instanceof Map) {
    keyboard.scopedStates = new Map<string, unknown>();
  }

  const pinned = pinnedModule.pinnedMessageManager as unknown as PinnedMessageManagerPrivateState;
  if (pinned && pinned.scopedRuntimes instanceof Map) {
    for (const runtime of pinned.scopedRuntimes.values()) {
      if (runtime.updateDebounceTimer) {
        clearTimeout(runtime.updateDebounceTimer);
      }
    }
    pinned.scopedRuntimes = new Map<string, { updateDebounceTimer: ReturnType<typeof setTimeout> | null }>();
    pinned.onKeyboardUpdateCallback = undefined;
  }

  const process = processManager as unknown as ProcessManagerPrivateState;
  process.state = {
    process: null,
    pid: null,
    startTime: null,
    isRunning: false,
  };

  __resetSessionDirectoryCacheForTests();
}
