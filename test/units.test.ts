import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCliArgs, UsageError } from "../src/args.js";
import { CpuTracker } from "../src/cpu.js";
import type { ProcessRecord } from "../src/model.js";
import { parseLinuxStat } from "../src/platform/linux.js";
import { parseMacPsLine, parsePsCpuTime } from "../src/platform/macos.js";
import { selectProcessTree } from "../src/platform/select-tree.js";
import { parseBytes, parseDuration, parsePercent } from "../src/units.js";

function record(
  pid: number,
  ppid: number,
  pgid: number,
  cpuTimeMs = 0,
  identity = `id-${pid}`,
): ProcessRecord {
  return { pid, ppid, pgid, cpuTimeMs, rssBytes: pid * 1_024, identity };
}

test("duration, byte, and percentage units parse exactly", () => {
  assert.equal(parseDuration("1.5s"), 1_500);
  assert.equal(parseDuration("2m"), 120_000);
  assert.equal(parseDuration("0ms", true), 0);
  assert.equal(parseBytes("1.5MiB"), 1_572_864);
  assert.equal(parseBytes("2GB"), 2_000_000_000);
  assert.equal(parsePercent("125%"), 125);
  assert.throws(() => parseDuration("5"));
  assert.throws(() => parseBytes("-1MiB"));
});

test("CLI parsing keeps command arguments opaque", () => {
  const parsed = parseCliArgs([
    "--timeout",
    "2m",
    "--memory=512MiB",
    "--cpu",
    "180%",
    "--",
    "npm",
    "test",
    "--",
    "--runInBand",
  ]);
  assert.equal(parsed.action, "run");
  if (parsed.action !== "run") return;
  assert.equal(parsed.options.command, "npm");
  assert.deepEqual(parsed.options.commandArgs, ["test", "--", "--runInBand"]);
  assert.equal(parsed.options.timeoutMs, 120_000);
  assert.equal(parsed.options.memoryBytes, 536_870_912);
  assert.equal(parsed.options.cpuPercent, 180);
});

test("CLI parsing requires a separator and at least one limit", () => {
  assert.throws(() => parseCliArgs(["node", "task.js"]), UsageError);
  assert.throws(() => parseCliArgs(["--", "node", "task.js"]), UsageError);
  assert.throws(
    () =>
      parseCliArgs([
        "--timeout",
        "1s",
        "--json",
        "report.json",
        "--markdown",
        "./report.json",
        "--",
        "node",
        "task.js",
      ]),
    UsageError,
  );
});

test("Linux proc stat parsing handles spaces in process names", () => {
  const stat =
    "42 (worker with spaces) R 1 42 42 0 -1 0 0 0 0 0 25 5 0 0 20 0 1 0 12345 999 50";
  const parsed = parseLinuxStat(stat, { clockTicksPerSecond: 100, pageSize: 4_096 });
  assert.deepEqual(parsed, {
    pid: 42,
    ppid: 1,
    pgid: 42,
    rssBytes: 204_800,
    cpuTimeMs: 300,
    identity: "linux:12345",
  });
});

test("macOS ps parsing handles cumulative CPU and stable start identity", () => {
  assert.equal(parsePsCpuTime("1-02:03:04.50"), 93_784_500);
  const parsed = parseMacPsLine(
    " 42  1  42  1024  0:03.25 Mon Aug  3 11:22:33 2026",
  );
  assert.deepEqual(parsed, {
    pid: 42,
    ppid: 1,
    pgid: 42,
    rssBytes: 1_048_576,
    cpuTimeMs: 3_250,
    identity: "darwin:Mon Aug 3 11:22:33 2026",
  });
});

test("tree selection follows descendants, process groups, and observed identities", () => {
  const records = [
    record(10, 1, 10),
    record(11, 10, 10),
    record(12, 11, 12),
    record(13, 1, 13, 0, "escaped"),
    record(14, 13, 14),
    record(99, 1, 99),
  ];
  const selected = selectProcessTree(records, 10, new Map([[13, "escaped"]]));
  assert.deepEqual(
    selected.map((item) => item.pid),
    [10, 11, 12, 13, 14],
  );
});

test("CPU tracking requires a continuous over-limit window", () => {
  const tracker = new CpuTracker();
  assert.equal(tracker.update([record(10, 1, 10, 100)], 0, 100, 2_000).exceeded, false);
  const first = tracker.update([record(10, 1, 10, 1_600)], 1_000, 100, 2_000);
  assert.equal(first.percent, 150);
  assert.equal(first.sustainedForMs, 1_000);
  assert.equal(first.exceeded, false);
  const second = tracker.update([record(10, 1, 10, 3_100)], 2_000, 100, 2_000);
  assert.equal(second.exceeded, true);
  const reset = tracker.update([record(10, 1, 10, 3_200)], 3_000, 100, 2_000);
  assert.equal(reset.sustainedForMs, 0);
  assert.equal(reset.exceeded, false);
});
