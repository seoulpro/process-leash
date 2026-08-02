import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProcessRecord, ProcessSnapshot } from "../model.js";
import { selectProcessTree } from "./select-tree.js";
import type { ProcessTable } from "./types.js";

const execFileAsync = promisify(execFile);

export function parsePsCpuTime(input: string): number | null {
  const dayParts = input.split("-");
  if (dayParts.length > 2) return null;
  const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
  const clock = dayParts[dayParts.length - 1]?.split(":") ?? [];
  if (clock.length < 2 || clock.length > 3) return null;

  const seconds = Number(clock[clock.length - 1]);
  const minutes = Number(clock[clock.length - 2]);
  const hours = clock.length === 3 ? Number(clock[0]) : 0;
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1_000;
}

export function parseMacPsLine(input: string): ProcessRecord | null {
  const fields = input.trim().split(/\s+/);
  if (fields.length < 10) return null;
  const pid = Number(fields[0]);
  const ppid = Number(fields[1]);
  const pgid = Number(fields[2]);
  const rssKiB = Number(fields[3]);
  const cpuTimeMs = parsePsCpuTime(fields[4] ?? "");
  const start = fields.slice(5, 10).join(" ");
  if (
    !Number.isInteger(pid) ||
    !Number.isInteger(ppid) ||
    !Number.isInteger(pgid) ||
    !Number.isFinite(rssKiB) ||
    cpuTimeMs === null ||
    start.length === 0
  ) {
    return null;
  }
  return {
    pid,
    ppid,
    pgid,
    rssBytes: Math.max(0, rssKiB) * 1_024,
    cpuTimeMs,
    identity: `darwin:${start}`,
  };
}

export class MacOsProcessTable implements ProcessTable {
  readonly measurement = "bsd-ps";

  async sample(rootPid: number, tracked: ReadonlyMap<number, string>): Promise<ProcessSnapshot> {
    const { stdout } = await execFileAsync(
      "/bin/ps",
      ["-axo", "pid=,ppid=,pgid=,rss=,time=,lstart="],
      { encoding: "utf8", maxBuffer: 10 * 1_024 * 1_024 },
    );
    const records = stdout
      .split("\n")
      .map(parseMacPsLine)
      .filter((record): record is ProcessRecord => record !== null);
    return { processes: selectProcessTree(records, rootPid, tracked) };
  }
}
