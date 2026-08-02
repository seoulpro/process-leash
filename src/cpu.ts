import type { ProcessRecord } from "./model.js";

interface PreviousCpu {
  identity: string;
  cpuTimeMs: number;
}

export interface CpuReading {
  percent: number;
  sustainedForMs: number;
  exceeded: boolean;
}

export class CpuTracker {
  private previous = new Map<number, PreviousCpu>();
  private previousAtMs: number | null = null;
  private overLimitSinceMs: number | null = null;

  update(
    processes: readonly ProcessRecord[],
    atMs: number,
    limitPercent: number | null,
    windowMs: number,
  ): CpuReading {
    const current = new Map<number, PreviousCpu>();
    for (const item of processes) {
      current.set(item.pid, { identity: item.identity, cpuTimeMs: item.cpuTimeMs });
    }

    if (this.previousAtMs === null || atMs <= this.previousAtMs) {
      this.previous = current;
      this.previousAtMs = atMs;
      return { percent: 0, sustainedForMs: 0, exceeded: false };
    }

    const intervalStart = this.previousAtMs;
    const elapsedMs = atMs - intervalStart;
    let cpuDeltaMs = 0;
    for (const [pid, item] of current) {
      const before = this.previous.get(pid);
      if (before?.identity === item.identity) {
        cpuDeltaMs += Math.max(0, item.cpuTimeMs - before.cpuTimeMs);
      } else {
        cpuDeltaMs += Math.max(0, item.cpuTimeMs);
      }
    }
    const percent = (cpuDeltaMs / elapsedMs) * 100;

    if (limitPercent !== null && percent > limitPercent) {
      this.overLimitSinceMs ??= intervalStart;
    } else {
      this.overLimitSinceMs = null;
    }
    const sustainedForMs =
      this.overLimitSinceMs === null ? 0 : Math.max(0, atMs - this.overLimitSinceMs);

    this.previous = current;
    this.previousAtMs = atMs;
    return {
      percent,
      sustainedForMs,
      exceeded: limitPercent !== null && sustainedForMs >= windowMs,
    };
  }
}
