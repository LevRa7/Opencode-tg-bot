import type { VmEnvironment, VmHandle, VmSpec } from "./types.js";
import type { NetworkPoolAllocator } from "./network-pool.js";
import type { VmStatePersistence } from "./state-persistence.js";
import { logger } from "../utils/logger.js";

export interface VmRuntimeProvider {
  id: string;
  environment: VmEnvironment;
}

export interface VmRuntimeRegistry {
  register(id: string, environment: VmEnvironment): void;
  get(id: string): VmEnvironment | undefined;
  list(): string[];
  allocateIp(userId: number, vmId: string): string;
  releaseIp(userId: number): boolean;
}

export function createVmRuntimeRegistry(
  pool: NetworkPoolAllocator,
): VmRuntimeRegistry {
  const providers = new Map<string, VmRuntimeProvider>();

  function register(id: string, environment: VmEnvironment): void {
    if (providers.has(id)) {
      logger.warn("[Registry] Provider %s already registered, replacing", id);
    }
    providers.set(id, { id, environment });
    logger.info("[Registry] Provider %s registered", id);
  }

  function get(id: string): VmEnvironment | undefined {
    return providers.get(id)?.environment;
  }

  function list(): string[] {
    return [...providers.keys()];
  }

  function allocateIp(userId: number, vmId: string): string {
    return pool.allocate(userId, vmId);
  }

  function releaseIp(userId: number): boolean {
    return pool.release(userId);
  }

  return { register, get, list, allocateIp, releaseIp };
}
