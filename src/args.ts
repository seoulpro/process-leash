import { resolve } from "node:path";
import type { CliOptions } from "./model.js";
import { parseBytes, parseDuration, parsePercent } from "./units.js";

export const VERSION = "0.1.0";

export class UsageError extends Error {}

export type ParseResult =
  | { action: "run"; options: CliOptions }
  | { action: "help" }
  | { action: "version" };

interface MutableOptions {
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

const DEFAULTS: MutableOptions = {
  timeoutMs: null,
  memoryBytes: null,
  cpuPercent: null,
  cpuWindowMs: 3_000,
  graceMs: 2_000,
  sampleIntervalMs: 250,
  jsonReportPath: null,
  markdownReportPath: null,
  quiet: false,
};

function takeValue(argv: string[], index: number, inline: string | undefined): [string, number] {
  if (inline !== undefined) return [inline, index];
  const value = argv[index + 1];
  if (value === undefined || value === "--") {
    throw new UsageError("an option value is missing");
  }
  return [value, index + 1];
}

function parsed<T>(parser: (value: string) => T, value: string, label: string): T {
  try {
    return parser(value);
  } catch {
    throw new UsageError(`${label} has an invalid value`);
  }
}

export function parseCliArgs(argv: string[]): ParseResult {
  const separator = argv.indexOf("--");
  const optionArgs = separator === -1 ? argv : argv.slice(0, separator);
  const commandArgs = separator === -1 ? [] : argv.slice(separator + 1);

  if (optionArgs.length === 1 && (optionArgs[0] === "--help" || optionArgs[0] === "-h")) {
    return { action: "help" };
  }
  if (optionArgs.length === 1 && (optionArgs[0] === "--version" || optionArgs[0] === "-V")) {
    return { action: "version" };
  }
  if (separator === -1) {
    throw new UsageError("expected -- before the command");
  }

  const options: MutableOptions = { ...DEFAULTS };
  for (let index = 0; index < optionArgs.length; index += 1) {
    const raw = optionArgs[index];
    if (raw === undefined) continue;
    const equals = raw.indexOf("=");
    const name = equals === -1 ? raw : raw.slice(0, equals);
    const inline = equals === -1 ? undefined : raw.slice(equals + 1);

    if (name === "--quiet" || name === "-q") {
      if (inline !== undefined) throw new UsageError("--quiet does not take a value");
      options.quiet = true;
      continue;
    }

    const [value, consumedIndex] = takeValue(optionArgs, index, inline);
    index = consumedIndex;
    switch (name) {
      case "--timeout":
      case "-t":
        options.timeoutMs = parsed((item) => parseDuration(item), value, "timeout");
        break;
      case "--memory":
      case "-m":
        options.memoryBytes = parsed(parseBytes, value, "memory limit");
        break;
      case "--cpu":
      case "-c":
        options.cpuPercent = parsed(parsePercent, value, "CPU limit");
        break;
      case "--cpu-window":
        options.cpuWindowMs = parsed((item) => parseDuration(item), value, "CPU window");
        break;
      case "--grace":
        options.graceMs = parsed((item) => parseDuration(item, true), value, "grace period");
        break;
      case "--interval":
        options.sampleIntervalMs = parsed((item) => parseDuration(item), value, "sample interval");
        break;
      case "--json":
      case "--report-json":
        options.jsonReportPath = value;
        break;
      case "--markdown":
      case "--report-markdown":
        options.markdownReportPath = value;
        break;
      default:
        throw new UsageError("an unknown option was provided");
    }
  }

  if (commandArgs.length === 0 || commandArgs[0] === undefined || commandArgs[0].length === 0) {
    throw new UsageError("a command is required after --");
  }
  if (options.timeoutMs === null && options.memoryBytes === null && options.cpuPercent === null) {
    throw new UsageError("at least one limit is required");
  }
  if (options.sampleIntervalMs < 50) {
    throw new UsageError("sample interval must be at least 50ms");
  }
  if (options.cpuPercent !== null && options.cpuWindowMs < options.sampleIntervalMs) {
    throw new UsageError("CPU window must not be shorter than the sample interval");
  }
  if (
    options.jsonReportPath !== null &&
    options.markdownReportPath !== null &&
    resolve(options.jsonReportPath) === resolve(options.markdownReportPath)
  ) {
    throw new UsageError("JSON and Markdown reports need different paths");
  }

  const [command, ...rest] = commandArgs;
  return {
    action: "run",
    options: {
      ...options,
      command,
      commandArgs: rest,
    },
  };
}

export const HELP = `process-leash ${VERSION}

Run a command under process-tree resource limits.

Usage:
  process-leash [options] -- <command> [arguments...]

Limits (at least one is required):
  -t, --timeout <duration>     Wall-clock limit, for example 90s or 5m
  -m, --memory <size>         Aggregate tree RSS, for example 512MiB
  -c, --cpu <percent>         Sustained tree CPU; 100% is one logical CPU
      --cpu-window <duration> Continuous over-limit window (default: 3s)

Termination and sampling:
      --grace <duration>      Time from SIGTERM to SIGKILL (default: 2s)
      --interval <duration>   Sampling interval, minimum 50ms (default: 250ms)

Reports:
      --json <path>           Write a JSON execution/incident report
      --markdown <path>       Write a Markdown execution/incident report
  -q, --quiet                 Suppress the final human-readable summary
  -h, --help                  Show help
  -V, --version               Show version

Reports never include command arguments, the working directory, environment
values, or captured child output. Child stdio is inherited directly.
`;
