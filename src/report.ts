import { rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { RunReport } from "./model.js";
import { formatBytes, formatDuration } from "./units.js";

function markdownValue(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function nullable(value: number | null, format: (item: number) => string): string {
  return value === null ? "not set" : format(value);
}

export function renderMarkdown(report: RunReport): string {
  const title = report.outcome === "limit-exceeded" ? "Incident Report" : "Execution Report";
  const breach =
    report.breach === null
      ? "None"
      : `${report.breach.kind}: ${report.breach.observed.toFixed(2)} ${report.breach.unit} ` +
        `(limit ${report.breach.limit.toFixed(2)}) at ${formatDuration(report.breach.atMs)}`;

  return `# Process Leash ${title}

| Field | Value |
| --- | --- |
| Outcome | ${markdownValue(report.outcome)} |
| Reason | ${markdownValue(report.reason)} |
| Platform | ${markdownValue(report.platform.os)} (${markdownValue(report.platform.measurement)}) |
| Started | ${markdownValue(report.timing.startedAt)} |
| Duration | ${formatDuration(report.timing.durationMs)} |
| Wrapper exit | ${report.exit.wrapperCode} |
| Command exit | ${report.exit.commandCode ?? "none"} |
| Command signal | ${report.exit.commandSignal ?? "none"} |
| Breach | ${markdownValue(breach)} |

## Policy

| Limit | Value |
| --- | ---: |
| Wall clock | ${nullable(report.limits.wallClockMs, formatDuration)} |
| Tree RSS | ${nullable(report.limits.treeRssBytes, formatBytes)} |
| Sustained CPU | ${nullable(report.limits.sustainedCpuPercent, (value) => `${value}%`)} |
| CPU window | ${formatDuration(report.limits.cpuWindowMs)} |
| Grace period | ${formatDuration(report.limits.graceMs)} |
| Sample interval | ${formatDuration(report.limits.sampleIntervalMs)} |

## Observed peaks

| Metric | Value |
| --- | ---: |
| Tree RSS | ${formatBytes(report.observed.peakTreeRssBytes)} |
| CPU | ${report.observed.peakCpuPercent.toFixed(2)}% |
| Process count | ${report.observed.peakProcessCount} |

## Termination

Initial signal: ${report.termination.initialSignal ?? "none"}.  
Escalated to SIGKILL: ${report.termination.escalated ? "yes" : "no"}.

## Privacy

Command arguments, the working directory, environment values, and child output are deliberately
excluded. Child output is inherited by the terminal and is not captured by Process Leash.
`;
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function writeReports(
  report: RunReport,
  jsonPath: string | null,
  markdownPath: string | null,
): Promise<void> {
  const writes: Promise<void>[] = [];
  if (jsonPath !== null) {
    writes.push(atomicWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`));
  }
  if (markdownPath !== null) {
    writes.push(atomicWrite(markdownPath, renderMarkdown(report)));
  }
  await Promise.all(writes);
}
