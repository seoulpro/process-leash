import type { Breach, RunReport } from "./model.js";
import { formatBytes, formatDuration } from "./units.js";

export function breachDescription(breach: Breach): string {
  switch (breach.kind) {
    case "wall-clock":
      return `wall clock ${formatDuration(breach.observed)} exceeded ${formatDuration(breach.limit)}`;
    case "tree-rss":
      return `tree RSS ${formatBytes(breach.observed)} exceeded ${formatBytes(breach.limit)}`;
    case "sustained-cpu":
      return `tree CPU ${breach.observed.toFixed(1)}% exceeded ${breach.limit.toFixed(1)}%`;
  }
}

export function renderSummary(report: RunReport): string {
  const sampled = report.observed.peakProcessCount > 0;
  const pieces = [
    report.outcome,
    `exit=${report.exit.wrapperCode}`,
    formatDuration(report.timing.durationMs),
    `peak RSS=${sampled ? formatBytes(report.observed.peakTreeRssBytes) : "not sampled"}`,
    `peak CPU=${sampled ? `${report.observed.peakCpuPercent.toFixed(1)}%` : "not sampled"}`,
    `peak processes=${sampled ? report.observed.peakProcessCount : "not sampled"}`,
  ];
  return `process-leash: ${pieces.join(" | ")}`;
}
