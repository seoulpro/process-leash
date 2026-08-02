import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { ProcessRecord, ProcessSnapshot } from "../model.js";
import { selectProcessTree } from "./select-tree.js";
import type { ProcessTable } from "./types.js";

const execFileAsync = promisify(execFile);

export interface LinuxStatConfig {
  clockTicksPerSecond: number;
  pageSize: number;
}

export function parseLinuxStat(
  input: string,
  config: LinuxStatConfig,
): ProcessRecord | null {
  const openParen = input.indexOf("(");
  const closeParen = input.lastIndexOf(")");
  if (openParen < 1 || closeParen <= openParen) return null;

  const pid = Number(input.slice(0, openParen).trim());
  const fields = input.slice(closeParen + 1).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  const pgid = Number(fields[2]);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  const startTicks = fields[19];
  const rssPages = Number(fields[21]);

  if (
    !Number.isInteger(pid) ||
    !Number.isInteger(ppid) ||
    !Number.isInteger(pgid) ||
    !Number.isFinite(userTicks) ||
    !Number.isFinite(systemTicks) ||
    startTicks === undefined ||
    !Number.isFinite(rssPages)
  ) {
    return null;
  }

  return {
    pid,
    ppid,
    pgid,
    rssBytes: Math.max(0, rssPages) * config.pageSize,
    cpuTimeMs: ((userTicks + systemTicks) * 1_000) / config.clockTicksPerSecond,
    identity: `linux:${startTicks}`,
  };
}

async function getconf(name: "CLK_TCK" | "PAGESIZE", fallback: number): Promise<number> {
  try {
    const { stdout } = await execFileAsync("getconf", [name], { encoding: "utf8" });
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export class LinuxProcessTable implements ProcessTable {
  readonly measurement = "procfs-stat";

  private constructor(private readonly config: LinuxStatConfig) {}

  static async create(): Promise<LinuxProcessTable> {
    const [clockTicksPerSecond, pageSize] = await Promise.all([
      getconf("CLK_TCK", 100),
      getconf("PAGESIZE", 4_096),
    ]);
    return new LinuxProcessTable({ clockTicksPerSecond, pageSize });
  }

  async sample(rootPid: number, tracked: ReadonlyMap<number, string>): Promise<ProcessSnapshot> {
    const entries = await readdir("/proc", { withFileTypes: true });
    const pids = entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name);

    const settled = await Promise.allSettled(
      pids.map(async (pid) => {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        return parseLinuxStat(stat, this.config);
      }),
    );
    const records: ProcessRecord[] = [];
    for (const item of settled) {
      if (item.status === "fulfilled" && item.value !== null) records.push(item.value);
    }
    return { processes: selectProcessTree(records, rootPid, tracked) };
  }
}
