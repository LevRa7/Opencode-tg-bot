export type VmSpecTier = "small" | "medium" | "large" | "xlarge";

export interface VmSpec {
  tier: VmSpecTier;
  ramMb: number;
  vcpus: number;
  diskGb: number;
  label: string;
}

export const VM_TIERS: Record<VmSpecTier, VmSpec> = {
  small:  { tier: "small",  ramMb: 4096,  vcpus: 2, diskGb: 20,  label: "Базовый" },
  medium: { tier: "medium", ramMb: 4096,  vcpus: 2, diskGb: 50,  label: "Стандартный" },
  large:  { tier: "large",  ramMb: 8192,  vcpus: 4, diskGb: 100, label: "Продвинутый" },
  xlarge: { tier: "xlarge", ramMb: 16384, vcpus: 8, diskGb: 250, label: "Максимальный" },
};

export const VM_DEFAULTS = {
  domainNamePrefix: "opencode-tg",
  imagesDir: process.env.VM_IMAGES_DIR || "/home/me/vm-images",
  baseImageName: "opencode-golden.qcow2",
  bridgeInterface: "macvtap0", // unused with default NAT network
  networkName: "vm-net",
  networkBridge: "virbr1",
  networkSubnetCidr: "10.100.0.0/24",
  networkHostIp: "10.100.0.1",
  networkDhcpStart: "10.100.0.10",
  networkDhcpEnd: "10.100.0.250",
  opencodePort: 4096,
  healthTimeoutMs: 900_000,
  healthPollMs: 2000,
  dhcpRetries: 60,
  dhcpRetryDelayMs: 5000,
  shutdownTimeoutMs: 30_000,
  forceDestroyTimeoutMs: 5_000,
};

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
}

export interface VmOperationResult {
  success: boolean;
  error?: string;
}
