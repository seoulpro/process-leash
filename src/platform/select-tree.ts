import type { ProcessRecord } from "../model.js";

export function selectProcessTree(
  records: readonly ProcessRecord[],
  rootPid: number,
  tracked: ReadonlyMap<number, string>,
): ProcessRecord[] {
  const selected = new Set<number>();

  for (const record of records) {
    if (
      record.pid === rootPid ||
      record.pgid === rootPid ||
      tracked.get(record.pid) === record.identity
    ) {
      selected.add(record.pid);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (!selected.has(record.pid) && selected.has(record.ppid)) {
        selected.add(record.pid);
        changed = true;
      }
    }
  }

  return records.filter((record) => selected.has(record.pid));
}
