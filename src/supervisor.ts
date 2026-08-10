import { spawn, type ChildProcess } from "node:child_process";
import { constants as osConstants } from "node:os";
import { performance } from "node:perf_hooks";
import { CpuTracker } from "./cpu.js";
import type {
  Breach,
  CliOptions,
  ProcessRecord,
  RunOutcome,
  RunReport,
} from "./model.js";
import { signalProcessTree } from "./platform/index.js";
import type { ProcessTable } from "./platform/types.js";
import { breachDescription } from "./summary.js";
import { formatDuration } from "./units.js";

const LIMIT_EXIT_CODE = 124;
const INTERNAL_EXIT_CODE = 125;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ExitState {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface TerminationState {
  attempted: boolean;
  initialSignal: NodeJS.Signals | null;
  escalated: boolean;
}

export interface SupervisorIo {
  warn(message: string): void;
}

export interface SupervisorDependencies {
  table: ProcessTable;
  now?: () => number;
  wallNow?: () => Date;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === null) return 1;
  const number = osConstants.signals[signal];
  return typeof number === "number" ? 128 + number : 1;
}

function mergeTracked(tracked: Map<number, string>, processes: readonly ProcessRecord[]): void {
  for (const item of processes) tracked.set(item.pid, item.identity);
}

export async function supervise(
  options: CliOptions,
  dependencies: SupervisorDependencies,
  io: SupervisorIo,
): Promise<RunReport> {
  const now = dependencies.now ?? (() => performance.now());
  const wallNow = dependencies.wallNow ?? (() => new Date());
  const startedMonotonic = now();
  const startedWall = wallNow();
  const tracked = new Map<number, string>();
  const cpu = new CpuTracker();
  let peakTreeRssBytes = 0;
  let peakCpuPercent = 0;
  let peakProcessCount = 0;
  let childExit: ExitState | null = null;
  let breach: Breach | null = null;
  let outcome: RunOutcome = "completed";
  let reason = "command-exited";
  let forcedWrapperCode: number | null = null;
  let finished = false;
  let sampling = false;
  let sampleQueued = false;
  let monitorTimer: NodeJS.Timeout | null = null;
  let wallTimer: NodeJS.Timeout | null = null;
  let terminationPromise: Promise<void> | null = null;
  let terminationFinished = false;
  const termination: TerminationState = {
    attempted: false,
    initialSignal: null,
    escalated: false,
  };

  let resolveReport: ((report: RunReport) => void) | undefined;
  const reportPromise = new Promise<RunReport>((resolve) => {
    resolveReport = resolve;
  });

  let child: ChildProcess;
  try {
    child = spawn(options.command, options.commandArgs, {
      stdio: "inherit",
      detached: true,
      env: process.env,
    });
  } catch {
    return buildReport("launch-error", "command-launch-failed", 126, null);
  }

  function buildReport(
    finalOutcome: RunOutcome,
    finalReason: string,
    wrapperCode: number,
    finalExit: ExitState | null,
  ): RunReport {
    const endedWall = wallNow();
    return {
      schemaVersion: 1,
      outcome: finalOutcome,
      reason: finalReason,
      platform: {
        os: process.platform,
        measurement: dependencies.table.measurement,
      },
      timing: {
        startedAt: startedWall.toISOString(),
        endedAt: endedWall.toISOString(),
        durationMs: Math.max(0, Math.round(now() - startedMonotonic)),
      },
      limits: {
        wallClockMs: options.timeoutMs,
        treeRssBytes: options.memoryBytes,
        sustainedCpuPercent: options.cpuPercent,
        cpuWindowMs: options.cpuWindowMs,
        graceMs: options.graceMs,
        sampleIntervalMs: options.sampleIntervalMs,
      },
      observed: {
        peakTreeRssBytes,
        peakCpuPercent: Math.round(peakCpuPercent * 100) / 100,
        peakProcessCount,
      },
      breach,
      termination: {
        attempted: termination.attempted,
        initialSignal: termination.initialSignal,
        escalated: termination.escalated,
        finalSignal: termination.escalated ? "SIGKILL" : null,
      },
      exit: {
        commandCode: finalExit?.code ?? null,
        commandSignal: finalExit?.signal ?? null,
        wrapperCode,
      },
      privacy: {
        commandArgumentsIncluded: false,
        workingDirectoryIncluded: false,
        environmentIncluded: false,
        childOutputCaptured: false,
      },
    };
  }

  function cleanup(): void {
    if (monitorTimer !== null) clearTimeout(monitorTimer);
    if (wallTimer !== null) clearTimeout(wallTimer);
    for (const signal of forwardedSignals) process.off(signal, handlers[signal]);
  }

  function finish(): void {
    if (finished || resolveReport === undefined) return;
    finished = true;
    cleanup();
    let wrapperCode: number;
    if (forcedWrapperCode !== null) {
      wrapperCode = forcedWrapperCode;
    } else if (childExit?.code !== null && childExit?.code !== undefined) {
      wrapperCode = childExit.code;
    } else {
      wrapperCode = signalExitCode(childExit?.signal ?? null);
    }
    resolveReport(buildReport(outcome, reason, wrapperCode, childExit));
  }

  async function terminateTree(initialSignal: NodeJS.Signals): Promise<void> {
    const rootPid = child.pid;
    if (rootPid === undefined) return;
    termination.attempted = true;
    termination.initialSignal = initialSignal;
    try {
      const initial = await signalProcessTree(
        dependencies.table,
        rootPid,
        tracked,
        initialSignal,
      );
      mergeTracked(tracked, initial.processes);
    } catch {
      // A later sample/kill attempt may still recover from a transient race.
    }

    const deadline = now() + options.graceMs;
    while (now() < deadline) {
      await delay(Math.min(50, Math.max(1, deadline - now())));
      try {
        const snapshot = await dependencies.table.sample(rootPid, tracked);
        mergeTracked(tracked, snapshot.processes);
        if (snapshot.processes.length === 0) return;
      } catch {
        break;
      }
    }

    try {
      const remaining = await dependencies.table.sample(rootPid, tracked);
      mergeTracked(tracked, remaining.processes);
      if (remaining.processes.length === 0) return;
    } catch {
      // Force the process group even when the final inspection fails.
    }

    termination.escalated = true;
    try {
      await signalProcessTree(dependencies.table, rootPid, tracked, "SIGKILL");
    } catch {
      // The target can disappear between inspection and signaling.
    }
    await delay(25);
  }

  function startTermination(initialSignal: NodeJS.Signals): void {
    if (terminationPromise !== null) return;
    terminationPromise = terminateTree(initialSignal).finally(() => {
      terminationFinished = true;
      if (childExit !== null) finish();
    });
  }

  function startBreach(nextBreach: Breach): void {
    if (breach !== null || forcedWrapperCode !== null || finished) return;
    breach = nextBreach;
    outcome = "limit-exceeded";
    reason = nextBreach.kind;
    forcedWrapperCode = LIMIT_EXIT_CODE;
    if (wallTimer !== null) clearTimeout(wallTimer);
    io.warn(
      `process-leash: warning: ${breachDescription(nextBreach)}; sending SIGTERM ` +
        `(${formatDuration(options.graceMs)} grace)`,
    );
    startTermination("SIGTERM");
  }

  function startMonitorFailure(): void {
    if (forcedWrapperCode !== null || finished) return;
    outcome = "monitor-error";
    reason = "process-measurement-failed";
    forcedWrapperCode = INTERNAL_EXIT_CODE;
    io.warn("process-leash: warning: process measurement failed; stopping the process tree");
    startTermination("SIGTERM");
  }

  function scheduleWallClockLimit(): void {
    if (
      options.timeoutMs === null ||
      finished ||
      breach !== null ||
      forcedWrapperCode !== null
    ) {
      return;
    }
    const atMs = Math.max(0, now() - startedMonotonic);
    const remainingMs = options.timeoutMs - atMs;
    if (remainingMs <= 0) {
      startBreach({
        kind: "wall-clock",
        limit: options.timeoutMs,
        observed: atMs,
        unit: "milliseconds",
        atMs,
      });
      return;
    }
    wallTimer = setTimeout(
      scheduleWallClockLimit,
      Math.min(remainingMs, MAX_TIMER_DELAY_MS),
    );
  }

  async function sample(): Promise<void> {
    if (finished) return;
    if (sampling) {
      sampleQueued = true;
      return;
    }
    const rootPid = child.pid;
    if (rootPid === undefined) return;
    sampling = true;
    try {
      const atMs = now() - startedMonotonic;
      const snapshot = await dependencies.table.sample(rootPid, tracked);
      mergeTracked(tracked, snapshot.processes);
      const rssBytes = snapshot.processes.reduce((sum, item) => sum + item.rssBytes, 0);
      const reading = cpu.update(
        snapshot.processes,
        atMs,
        options.cpuPercent,
        options.cpuWindowMs,
      );
      peakTreeRssBytes = Math.max(peakTreeRssBytes, rssBytes);
      peakCpuPercent = Math.max(peakCpuPercent, reading.percent);
      peakProcessCount = Math.max(peakProcessCount, snapshot.processes.length);

      if (breach === null && forcedWrapperCode === null) {
        if (options.memoryBytes !== null && rssBytes > options.memoryBytes) {
          startBreach({
            kind: "tree-rss",
            limit: options.memoryBytes,
            observed: rssBytes,
            unit: "bytes",
            atMs,
          });
        } else if (options.cpuPercent !== null && reading.exceeded) {
          startBreach({
            kind: "sustained-cpu",
            limit: options.cpuPercent,
            observed: reading.percent,
            unit: "percent",
            atMs,
          });
        }
      }

      if (childExit !== null && breach === null && forcedWrapperCode === null) {
        if (snapshot.processes.length === 0) finish();
      }
    } catch {
      startMonitorFailure();
    } finally {
      sampling = false;
      if (!finished) {
        if (sampleQueued) {
          sampleQueued = false;
          void sample();
        } else {
          monitorTimer = setTimeout(() => void sample(), options.sampleIntervalMs);
        }
      }
    }
  }

  const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const handlers: Record<(typeof forwardedSignals)[number], () => void> = {
    SIGINT: () => interrupt("SIGINT"),
    SIGTERM: () => interrupt("SIGTERM"),
    SIGHUP: () => interrupt("SIGHUP"),
  };

  function interrupt(signal: (typeof forwardedSignals)[number]): void {
    if (finished) return;
    if (forcedWrapperCode !== null) {
      if (child.pid !== undefined) {
        void signalProcessTree(dependencies.table, child.pid, tracked, "SIGKILL");
      }
      return;
    }
    outcome = "interrupted";
    reason = `received-${signal.toLowerCase()}`;
    forcedWrapperCode = signalExitCode(signal);
    io.warn(`process-leash: warning: received ${signal}; forwarding it to the process tree`);
    startTermination(signal);
  }

  for (const signal of forwardedSignals) process.on(signal, handlers[signal]);

  child.once("error", (error: NodeJS.ErrnoException) => {
    if (finished) return;
    outcome = "launch-error";
    reason = "command-launch-failed";
    forcedWrapperCode = error.code === "ENOENT" ? 127 : 126;
    childExit = { code: null, signal: null };
    terminationFinished = true;
    finish();
  });

  child.once("exit", (code, signal) => {
    childExit = { code, signal };
    if (terminationPromise !== null) {
      if (terminationFinished) finish();
    } else {
      void sample();
    }
  });

  scheduleWallClockLimit();

  void sample();
  return reportPromise;
}
