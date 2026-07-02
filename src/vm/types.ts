import path from "path";

export const GOLDEN_VERSION_FILE = "/etc/opencode/golden-version";

export type VmSpecTier = "small" | "medium" | "large" | "xlarge";

export interface VmSpec {
  tier: VmSpecTier;
  ramMb: number;
  vcpus: number;
  diskGb: number;
  label: string;
}

export const VM_TIERS: Record<VmSpecTier, VmSpec> = {
  small:  { tier: "small",  ramMb: 2048,  vcpus: 1, diskGb: 20,  label: "Базовый" },
  medium: { tier: "medium", ramMb: 4096,  vcpus: 2, diskGb: 40,  label: "Стандартный" },
  large:  { tier: "large",  ramMb: 8192,  vcpus: 4, diskGb: 80,  label: "Продвинутый" },
  xlarge: { tier: "xlarge", ramMb: 16384, vcpus: 8, diskGb: 120, label: "Максимальный" },
};

export const VM_DEFAULTS = {
  domainNamePrefix: "opencode-tg",
  imagesDir: process.env.VM_IMAGES_DIR || "/home/me/vm-images",
  baseImageName: "opencode-golden.qcow2",
  bridgeInterface: "macvtap0", // unused with default NAT network
  networkName: "vm-net",
  networkBridge: "vm-br0",
  networkSubnetCidr: "192.168.123.0/24",
  networkHostIp: "192.168.123.1",
  networkDhcpStart: "192.168.123.10",
  networkDhcpEnd: "192.168.123.250",
  opencodePort: 4096,
  healthTimeoutMs: 900_000,
  healthPollMs: 2000,
  dhcpRetries: 60,
  dhcpRetryDelayMs: 5000,
  shutdownTimeoutMs: 30_000,
  forceDestroyTimeoutMs: 5_000,
};

export function getDataDiskPath(userId: number): string {
  return path.join(VM_DEFAULTS.imagesDir, `${VM_DEFAULTS.domainNamePrefix}-${userId}-data.qcow2`);
}

export interface VmInfo {
  userId: number;
  tier: VmSpecTier;
  domainName: string;
  qcow2Path: string;
  cloudInitIsoPath: string;
  bridgeIp: string | null;
  baseUrl: string;
  startTime: string;
  pid: number | null;
  sudoPassword?: string;
  serverPassword?: string;
  ipv6?: string;
}

export interface VmOperationResult {
  success: boolean;
  error?: string;
}

export interface VmHandle {
  vmId: string;
  userId: number;
  domainName: string;
  ipv4: string;
  mac: string;
  baseUrl: string;
  password: string;
  specTier: string;
}

export interface VmEnvironment {
  provision(userId: number, spec: VmSpec): Promise<VmHandle>;
  attach(userId: number): Promise<VmHandle | null>;
  healthCheck(handle: VmHandle): Promise<import("./health-proxy.js").HealthStatus>;
  destroy(handle: VmHandle): Promise<VmOperationResult>;
}

import { createHash } from "node:crypto";

export function derivePassword(userId: number, specTier: string): string {
  return createHash("sha256")
    .update(`vm:${userId}:${specTier}:opencode-tg-secret`)
    .digest("base64url")
    .slice(0, 16);
}
