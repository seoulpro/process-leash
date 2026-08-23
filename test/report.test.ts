import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunReport } from "../src/model.js";
import { renderMarkdown, writeReports } from "../src/report.js";
import { renderSummary } from "../src/summary.js";

const report: RunReport = {
  schemaVersion: 1,
  outcome: "limit-exceeded",
  reason: "tree-rss",
  platform: { os: "linux", measurement: "fixture" },
  timing: {
    startedAt: "2026-08-03T00:00:00.000Z",
    endedAt: "2026-08-03T00:00:01.000Z",
    durationMs: 1_000,
  },
  limits: {
    wallClockMs: 5_000,
    treeRssBytes: 1_024,
    sustainedCpuPercent: null,
    cpuWindowMs: 3_000,
    graceMs: 500,
    sampleIntervalMs: 100,
  },
  observed: { peakTreeRssBytes: 2_048, peakCpuPercent: 50, peakProcessCount: 2 },
  breach: {
    kind: "tree-rss",
    limit: 1_024,
    observed: 2_048,
    unit: "bytes",
    atMs: 500,
  },
  termination: {
    attempted: true,
    initialSignal: "SIGTERM",
    escalated: false,
    finalSignal: null,
  },
  exit: { commandCode: null, commandSignal: "SIGTERM", wrapperCode: 124 },
  privacy: {
    commandArgumentsIncluded: false,
    workingDirectoryIncluded: false,
    environmentIncluded: false,
    childOutputCaptured: false,
  },
};

test("Markdown report contains metrics but no command field", () => {
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Incident Report/);
  assert.match(markdown, /2\.00 KiB/);
  assert.doesNotMatch(markdown, /command arguments?:/i);
});

test("human-readable output distinguishes missing samples from zero usage", () => {
  const unsampled: RunReport = {
    ...report,
    observed: {
      peakTreeRssBytes: 0,
      peakCpuPercent: 0,
      peakProcessCount: 0,
    },
  };

  const summary = renderSummary(unsampled);
  assert.match(summary, /peak RSS=not sampled/);
  assert.match(summary, /peak CPU=not sampled/);
  assert.match(summary, /peak processes=not sampled/);

  const markdown = renderMarkdown(unsampled);
  assert.match(markdown, /\| Tree RSS \| not sampled \|/);
  assert.match(markdown, /\| CPU \| not sampled \|/);
  assert.match(markdown, /\| Process count \| not sampled \|/);
});

test("report files are written with the stable schema", async () => {
  const directory = await mkdtemp(join(tmpdir(), "process-leash-test-"));
  try {
    const jsonPath = join(directory, "incident.json");
    const markdownPath = join(directory, "incident.md");
    await writeReports(report, jsonPath, markdownPath);
    const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as RunReport;
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.exit.wrapperCode, 124);
    assert.match(await readFile(markdownPath, "utf8"), /environment values/);
    assert.equal((await stat(jsonPath)).mode & 0o777, 0o600);
    assert.equal((await stat(markdownPath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed replacement does not leave a temporary report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "process-leash-test-"));
  try {
    const occupied = join(directory, "occupied");
    await mkdir(occupied);
    await assert.rejects(writeReports(report, occupied, null));
    assert.deepEqual(await readdir(directory), ["occupied"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
