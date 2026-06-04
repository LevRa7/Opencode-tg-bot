import * as os from "os";

export interface CpuInfo {
  model: string;
  usagePercent: number;
}

export interface RamInfo {
  usedGB: number;
  totalGB: number;
  percentUsed: number;
}

export interface SystemInfo {
  cpu: CpuInfo;
  ram: RamInfo;
}

interface CpuTimes {
  idle: number;
  total: number;
}

let previousCpuTimes: CpuTimes | null = null;

function getCpuTimes(): CpuTimes {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    for (const type of Object.values(cpu.times)) {
      total += type;
    }
  }
  return { idle, total };
}

function shortenCpuModel(model: string): string {
  return model
    .replace(/\(R\)/g, "")
    .replace(/\(TM\)/g, "")
    .replace(/ CPU /g, " ")
    .replace(/ [0-9.]+GHz/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 35);
}

export function getSystemInfo(): SystemInfo {
  const cpuModel = shortenCpuModel(os.cpus()[0]?.model ?? "Unknown CPU");
  const currentCpuTimes = getCpuTimes();
  let cpuUsagePercent = 0;

  if (previousCpuTimes) {
    const idleDelta = currentCpuTimes.idle - previousCpuTimes.idle;
    const totalDelta = currentCpuTimes.total - previousCpuTimes.total;
    if (totalDelta > 0) {
      cpuUsagePercent = Math.min(
        100,
        Math.max(0, 100 - (idleDelta / totalDelta) * 100),
      );
    }
  }
  previousCpuTimes = currentCpuTimes;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramUsedGB = Math.round((usedMem / (1024 * 1024 * 1024)) * 10) / 10;
  const ramTotalGB = Math.round((totalMem / (1024 * 1024 * 1024)) * 10) / 10;
  const ramPercentUsed = Math.round((usedMem / totalMem) * 100);

  return {
    cpu: {
      model: cpuModel.trim(),
      usagePercent: Math.round(cpuUsagePercent * 10) / 10,
    },
    ram: {
      usedGB: ramUsedGB,
      totalGB: ramTotalGB,
      percentUsed: ramPercentUsed,
    },
  };
}
