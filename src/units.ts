const DURATION_FACTORS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

const SIZE_FACTORS: Readonly<Record<string, number>> = {
  b: 1,
  k: 1_000,
  kb: 1_000,
  kib: 1_024,
  m: 1_000_000,
  mb: 1_000_000,
  mib: 1_048_576,
  g: 1_000_000_000,
  gb: 1_000_000_000,
  gib: 1_073_741_824,
};

function checkedInteger(value: number, allowZero: boolean): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0 || (!allowZero && rounded === 0)) {
    throw new Error("value is outside the supported range");
  }
  return rounded;
}

export function parseDuration(input: string, allowZero = false): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/i.exec(input);
  if (match === null) {
    throw new Error("duration must use ms, s, m, or h");
  }
  const amount = Number(match[1]);
  const factor = DURATION_FACTORS[match[2]?.toLowerCase() ?? ""];
  if (!Number.isFinite(amount) || factor === undefined) {
    throw new Error("duration is invalid");
  }
  return checkedInteger(amount * factor, allowZero);
}

export function parseBytes(input: string): number {
  const match = /^(\d+(?:\.\d+)?)(b|k|kb|kib|m|mb|mib|g|gb|gib)$/i.exec(input);
  if (match === null) {
    throw new Error("size must use B, KB, KiB, MB, MiB, GB, or GiB");
  }
  const amount = Number(match[1]);
  const factor = SIZE_FACTORS[match[2]?.toLowerCase() ?? ""];
  if (!Number.isFinite(amount) || factor === undefined) {
    throw new Error("size is invalid");
  }
  return checkedInteger(amount * factor, false);
}

export function parsePercent(input: string): number {
  const match = /^(\d+(?:\.\d+)?)%?$/.exec(input);
  if (match === null) {
    throw new Error("CPU must be a positive percentage");
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("CPU must be a positive percentage");
  }
  return value;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(2)}s`;
  return `${(milliseconds / 60_000).toFixed(2)}m`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1_024 && index < units.length - 1) {
    value /= 1_024;
    index += 1;
  }
  const digits = index === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}
