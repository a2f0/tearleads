function invalidWalLsn(label?: string): never {
  throw new Error(label ? `${label} is invalid` : "Invalid WAL LSN.");
}

function parseWalLsnSegment(segment: string | undefined, label?: string) {
  if (!segment) {
    invalidWalLsn(label);
  }

  try {
    return BigInt(`0x${segment}`);
  } catch {
    invalidWalLsn(label);
  }
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
  if (typeof value !== "string") {
    return false;
  }

  try {
    parseWalLsn(value);
    return true;
  } catch {
    return false;
  }
}
