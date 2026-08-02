import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { RunReport } from "../src/model.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(projectRoot, "dist", "cli.js");
const fixtures = join(projectRoot, "test", "fixtures");

interface Execution {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Promise<Execution> {
  return new Promise((resolveExecution, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExecution({ code, signal, stdout, stderr }));
  });
}

test("the wrapped command exit code is preserved", async () => {
  const result = await run([
    "--timeout",
    "2s",
    "--quiet",
    "--",
    process.execPath,
    join(fixtures, "exit.mjs"),
    "7",
  ]);
  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
});

test("wall-clock breach escalates an uncooperative process tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "process-leash-test-"));
  try {
    const jsonPath = join(directory, "incident.json");
    const result = await run([
      "--timeout",
      "350ms",
      "--grace",
      "100ms",
      "--interval",
      "50ms",
      "--json",
      jsonPath,
      "--",
      process.execPath,
      join(fixtures, "spawn-tree.mjs"),
    ]);
    assert.equal(result.code, 124);
    assert.match(result.stderr, /warning: wall clock/);
    const report = JSON.parse(await readFile(jsonPath, "utf8")) as RunReport;
    assert.equal(report.outcome, "limit-exceeded");
    assert.equal(report.reason, "wall-clock");
    assert.equal(report.termination.escalated, true);
    assert.ok(report.observed.peakProcessCount >= 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sustained CPU is enforced across samples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "process-leash-test-"));
  try {
    const jsonPath = join(directory, "incident.json");
    const result = await run([
      "--timeout",
      "3s",
      "--cpu",
      "10%",
      "--cpu-window",
      "250ms",
      "--interval",
      "50ms",
      "--grace",
      "50ms",
      "--quiet",
      "--json",
      jsonPath,
      "--",
      process.execPath,
      join(fixtures, "burn.mjs"),
    ]);
    assert.equal(result.code, 124);
    const report = JSON.parse(await readFile(jsonPath, "utf8")) as RunReport;
    assert.equal(report.reason, "sustained-cpu");
    assert.ok(report.observed.peakCpuPercent > 10);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aggregate RSS is enforced against a real allocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "process-leash-test-"));
  try {
    const jsonPath = join(directory, "incident.json");
    const result = await run([
      "--timeout",
      "3s",
      "--memory",
      "96MiB",
      "--interval",
      "50ms",
      "--grace",
      "100ms",
      "--quiet",
      "--json",
      jsonPath,
      "--",
      process.execPath,
      join(fixtures, "memory.mjs"),
    ]);
    assert.equal(result.code, 124);
    const report = JSON.parse(await readFile(jsonPath, "utf8")) as RunReport;
    assert.equal(report.reason, "tree-rss");
    assert.ok(report.observed.peakTreeRssBytes > 96 * 1_024 * 1_024);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports omit sensitive arguments and local execution paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "process-leash-test-"));
  try {
    const jsonPath = join(directory, "report.json");
    const markdownPath = join(directory, "report.md");
    const sensitiveMarker = "sensitive-marker-value";
    const result = await run([
      "--timeout",
      "2s",
      "--quiet",
      "--json",
      jsonPath,
      "--markdown",
      markdownPath,
      "--",
      process.execPath,
      join(fixtures, "exit.mjs"),
      "0",
      sensitiveMarker,
    ]);
    assert.equal(result.code, 0);
    const combined = `${await readFile(jsonPath, "utf8")}\n${await readFile(markdownPath, "utf8")}`;
    assert.doesNotMatch(combined, new RegExp(sensitiveMarker));
    assert.doesNotMatch(combined, new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
