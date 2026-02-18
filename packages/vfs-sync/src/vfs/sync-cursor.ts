interface VfsSyncCursorPayload {
  version: 1;
  changedAt: string;
  changeId: string;
}

export interface VfsSyncCursor {
  changedAt: string;
  changeId: string;
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function encodeVfsSyncCursor(cursor: VfsSyncCursor): string {
  const payload: VfsSyncCursorPayload = {
    version: 1,
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeVfsSyncCursor(cursor: string): VfsSyncCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      !('changedAt' in parsed) ||
      !('changeId' in parsed)
    ) {
      return null;
    }

    const version = parsed['version'];
    const changedAt = parsed['changedAt'];
    const changeId = parsed['changeId'];

    if (
      version !== 1 ||
      typeof changedAt !== 'string' ||
      typeof changeId !== 'string' ||
      !changedAt.trim() ||
      !changeId.trim() ||
      !isValidIsoTimestamp(changedAt)
    ) {
      return null;
    }

    return {
      changedAt,
      changeId
    };
  } catch {
    return null;
  }
}
