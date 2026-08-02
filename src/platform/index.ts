import type { ProcessSnapshot } from "../model.js";
import { LinuxProcessTable } from "./linux.js";
import { MacOsProcessTable } from "./macos.js";
import type { ProcessTable } from "./types.js";

export async function createProcessTable(platform = process.platform): Promise<ProcessTable> {
  if (platform === "linux") return LinuxProcessTable.create();
  if (platform === "darwin") return new MacOsProcessTable();
  throw new Error("this platform is not supported yet; Linux and macOS are supported");
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ESRCH" || error.code === "EINVAL")
  );
}

export async function signalProcessTree(
  table: ProcessTable,
  rootPid: number,
  tracked: ReadonlyMap<number, string>,
  signal: NodeJS.Signals,
): Promise<ProcessSnapshot> {
  let snapshot: ProcessSnapshot = { processes: [] };
  try {
    snapshot = await table.sample(rootPid, tracked);
  } catch {
    // The process group signal below is still useful if sampling races with exit.
  }

  try {
    process.kill(-rootPid, signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }

  for (const record of snapshot.processes) {
    try {
      process.kill(record.pid, signal);
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
    }
  }
  return snapshot;
}
