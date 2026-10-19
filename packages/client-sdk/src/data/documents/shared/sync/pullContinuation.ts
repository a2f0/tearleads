import {
  isWalLsnString,
  MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH,
} from "@tearleads/validators/util";

export type DocumentSyncCommitLsnMode = "tracked" | "untracked";

export interface DocumentSyncPullContinuation {
  readonly commitLsn: string;
  readonly commitLsnMode: DocumentSyncCommitLsnMode;
  readonly cursor: string;
}

export function documentSyncPullContinuationsEqual(
  left: DocumentSyncPullContinuation | null | undefined,
  right: DocumentSyncPullContinuation | null | undefined,
): boolean {
  if (!left || !right) return left == null && right == null;
  return (
    left.commitLsn === right.commitLsn &&
    left.commitLsnMode === right.commitLsnMode &&
    left.cursor === right.cursor
  );
}

type PersistedDocumentSyncPullContinuation = readonly [
  version: 1,
  commitLsnMode: DocumentSyncCommitLsnMode,
  commitLsn: string,
  cursor: string,
];

/**
 * Non-null durable value used after the server rejects a cursor. Readers treat
 * it like any other undecodable continuation and force page-one recovery, but
 * ordinary saves preserve it until a successful sync settlement explicitly
 * replaces or clears the continuation.
 */
export const DOCUMENT_SYNC_PULL_RECOVERY_REQUIRED = '[0,"recovery-required"]';

function isValidCheckpoint(
  mode: unknown,
  commitLsn: unknown,
): mode is DocumentSyncCommitLsnMode {
  return (
    (mode === "tracked" && commitLsn !== "0/0" && isWalLsnString(commitLsn)) ||
    (mode === "untracked" && commitLsn === "0/0")
  );
}

/** Decode untrusted local state; malformed progress restarts from page one. */
export function deserializeDocumentSyncPullContinuation(
  value: string | null,
): DocumentSyncPullContinuation | null {
  if (value === null) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [version, commitLsnMode, commitLsn, cursor] = parsed;
    if (
      version !== 1 ||
      !isValidCheckpoint(commitLsnMode, commitLsn) ||
      typeof commitLsn !== "string" ||
      typeof cursor !== "string" ||
      cursor.length === 0 ||
      cursor.length > MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH
    ) {
      return null;
    }
    return { commitLsn, commitLsnMode, cursor };
  } catch {
    return null;
  }
}

export function serializeDocumentSyncPullContinuation(
  continuation: DocumentSyncPullContinuation | null,
): string | null {
  if (continuation === null) return null;
  return JSON.stringify([
    1,
    continuation.commitLsnMode,
    continuation.commitLsn,
    continuation.cursor,
  ] satisfies PersistedDocumentSyncPullContinuation);
}
