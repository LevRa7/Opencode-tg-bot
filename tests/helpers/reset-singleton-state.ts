interface KeyboardManagerPrivateState {
  state: null;
  api: null;
  chatId: null;
  lastUpdateTime: number;
}

interface PinnedMessageManagerPrivateState {
  api: null;
  chatId: null;
  contextLimit: null;
  updateDebounceTimer: ReturnType<typeof setTimeout> | null;
  onKeyboardUpdateCallback: undefined;
  state: {
    messageId: null;
    chatId: null;
    sessionId: null;
    sessionTitle: string;
    projectName: string;
    tokensUsed: number;
    tokensLimit: number;
    lastUpdated: number;
    changedFiles: Array<{ file: string; additions: number; deletions: number }>;
  };
}

interface ProcessManagerPrivateState {
  state: {
    process: null;
    pid: null;
    startTime: null;
    isRunning: boolean;
  };
}

function hasExport(module: object, exportName: string): boolean {
  return exportName in module;
}

export async function resetSingletonState(): Promise<void> {
  const [
    questionModule,
    permissionModule,
    renameModule,
    interactionModule,
    summaryModule,
    keyboardModule,
    pinnedModule,
    processModule,
    eventModule,
    sessionCacheModule,
    threadModule,
    opencodeClientModule,
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
    import("../../src/thread/manager.js"),
    import("../../src/opencode/client.js"),
  ]);

  const { questionManager } = questionModule;
  const { permissionManager } = permissionModule;
  const { renameManager } = renameModule;
  const { interactionManager } = interactionModule;
  const { keyboardManager } = keyboardModule;
  const { pinnedMessageManager } = pinnedModule;
  const { processManager } = processModule;
  const { threadContextManager } = threadModule;

  if (hasExport(eventModule, "stopAllEventListening")) {
    (eventModule.stopAllEventListening as () => void)();
  }
  questionManager.__resetForTests();
  permissionManager.__resetForTests();
  renameManager.clear();
  interactionManager.__resetForTests();
  if (hasExport(summaryModule, "__resetSummaryAggregatorsForTests")) {
    (summaryModule.__resetSummaryAggregatorsForTests as () => void)();
  }
  if (hasExport(opencodeClientModule, "__resetOpencodeClientRegistryForTests")) {
    (opencodeClientModule.__resetOpencodeClientRegistryForTests as () => void)();
  }

  const keyboard = keyboardManager as unknown as KeyboardManagerPrivateState;
  keyboard.state = null;
  keyboard.api = null;
  keyboard.chatId = null;
  keyboard.lastUpdateTime = 0;

  const pinned = pinnedMessageManager as unknown as PinnedMessageManagerPrivateState;
  if (pinned.updateDebounceTimer) {
    clearTimeout(pinned.updateDebounceTimer);
  }
  pinned.updateDebounceTimer = null;
  pinned.api = null;
  pinned.chatId = null;
  pinned.contextLimit = null;
  pinned.onKeyboardUpdateCallback = undefined;
  pinned.state = {
    messageId: null,
    chatId: null,
    sessionId: null,
    sessionTitle: "new session",
    projectName: "",
    tokensUsed: 0,
    tokensLimit: 0,
    lastUpdated: 0,
    changedFiles: [],
  };

  const process = processManager as unknown as ProcessManagerPrivateState;
  process.state = {
    process: null,
    pid: null,
    startTime: null,
    isRunning: false,
  };

  sessionCacheModule.__resetSessionDirectoryCacheForTests();
  threadContextManager.__resetForTests();
}
