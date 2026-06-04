import type { ModelInfo } from "../model/types.js";
import type { CpuInfo, RamInfo } from "../utils/system-info.js";

export enum SessionType {
  AGENT = "agent",
  TERMINAL = "terminal",
  NONE = "none",
}

/**
 * Context information for keyboard button
 */
export interface ContextInfo {
  tokensUsed: number;
  tokensLimit: number;
}

/**
 * Keyboard state containing all information for building the Reply Keyboard
 */
export interface KeyboardState {
  currentAgent: string;
  currentModel: ModelInfo;
  contextInfo: ContextInfo | null;
  variantName?: string;
  isRunning?: boolean;
  cpuInfo?: CpuInfo;
  ramInfo?: RamInfo;
  sessionMode: SessionType;
}
