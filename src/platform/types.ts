import type { ProcessSnapshot } from "../model.js";

export interface ProcessTable {
  readonly measurement: string;
  sample(rootPid: number, tracked: ReadonlyMap<number, string>): Promise<ProcessSnapshot>;
}
