export type LimitKind = "wall-clock" | "tree-rss" | "sustained-cpu";

export interface CliOptions {
  command: string;
  commandArgs: string[];
  timeoutMs: number | null;
  memoryBytes: number | null;
  cpuPercent: number | null;
  cpuWindowMs: number;
  graceMs: number;
  sampleIntervalMs: number;
  jsonReportPath: string | null;
  markdownReportPath: string | null;
  quiet: boolean;
}

export interface ProcessRecord {
  pid: number;
  ppid: number;
  pgid: number;
  rssBytes: number;
  cpuTimeMs: number;
  identity: string;
}

export interface ProcessSnapshot {
  processes: ProcessRecord[];
}

export interface Breach {
  kind: LimitKind;
  limit: number;
  observed: number;
  unit: "milliseconds" | "bytes" | "percent";
  atMs: number;
}

export type RunOutcome =
  | "completed"
  | "limit-exceeded"
  | "interrupted"
  | "launch-error"
  | "monitor-error";

export interface RunReport {
  schemaVersion: 1;
  outcome: RunOutcome;
  reason: string;
  platform: {
    os: NodeJS.Platform;
    measurement: string;
  };
  timing: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
  limits: {
    wallClockMs: number | null;
    treeRssBytes: number | null;
    sustainedCpuPercent: number | null;
    cpuWindowMs: number;
    graceMs: number;
    sampleIntervalMs: number;
  };
  observed: {
    peakTreeRssBytes: number;
    peakCpuPercent: number;
    peakProcessCount: number;
  };
  breach: Breach | null;
  termination: {
    attempted: boolean;
    initialSignal: NodeJS.Signals | null;
    escalated: boolean;
    finalSignal: "SIGKILL" | null;
  };
  exit: {
    commandCode: number | null;
    commandSignal: NodeJS.Signals | null;
    wrapperCode: number;
  };
  privacy: {
    commandArgumentsIncluded: false;
    workingDirectoryIncluded: false;
    environmentIncluded: false;
    childOutputCaptured: false;
  };
}
