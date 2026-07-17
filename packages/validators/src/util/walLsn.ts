export const WAL_LSN_PATTERN = /^[0-9A-Fa-f]{1,8}\/[0-9A-Fa-f]{1,8}$/;

function invalidWalLsn(label?: string): never {
  throw new Error(label ? `${label} is invalid` : "Invalid WAL LSN.");
}

function parseWalLsnSegment(segment: string | undefined, label?: string) {
  if (!segment || !/^[0-9A-Fa-f]{1,8}$/.test(segment)) {
    invalidWalLsn(label);
  }

  return BigInt(`0x${segment}`);
}

export function parseWalLsn(value: string, label?: string): bigint {
  const parts = value.split("/");
  if (parts.length !== 2) {
    invalidWalLsn(label);
  }

  return (
    (parseWalLsnSegment(parts[0], label) << 32n) +
    parseWalLsnSegment(parts[1], label)
  );
}

export function isWalLsnString(value: unknown): value is string {
  return typeof value === "string" && WAL_LSN_PATTERN.test(value);
}
