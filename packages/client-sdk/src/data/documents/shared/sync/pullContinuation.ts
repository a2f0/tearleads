import {
  isWalLsnString,
  MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH,
} from "@tearleads/validators/util";
import type { BaselineGroupRun } from "./baselineGroupMachine";

export type DocumentSyncCommitLsnMode = "tracked" | "untracked";

export interface DocumentSyncPullContinuation {
  /**
   * The rotation baseline the page before this cursor ended inside; absent
   * or null when it ended outside one. The next page checks the baseline's
   * remaining segments against it (`judgeServedBaselineGroups`), and is
   * requested with no version while the baseline is followed whole
   * (`pullPageVersion`).
   */
  readonly baselineGroupRun?: BaselineGroupRun | null | undefined;
  readonly commitLsn: string;
  readonly commitLsnMode: DocumentSyncCommitLsnMode;
  readonly cursor: string;
}

/**
 * The run a request sent with `pullCursor` continues. A run belongs to the
 * cursor it was recorded with: a request that sends no cursor, or another
 * one, starts its pull, and every group in it, over.
 */
export function continuedBaselineGroupRun(
  continuation: DocumentSyncPullContinuation | null | undefined,
  pullCursor: string | undefined,
): BaselineGroupRun | null {
  if (!continuation || continuation.cursor !== pullCursor) return null;
  return continuation.baselineGroupRun ?? null;
}

function baselineGroupRunsEqual(
  left: BaselineGroupRun | null | undefined,
  right: BaselineGroupRun | null | undefined,
): boolean {
  if (!left || !right) return left == null && right == null;
  return (
    left.baselineId === right.baselineId &&
    left.digest === right.digest &&
    left.nextIndex === right.nextIndex &&
    left.unapplied === right.unapplied
  );
}

export function documentSyncPullContinuationsEqual(
  left: DocumentSyncPullContinuation | null | undefined,
  right: DocumentSyncPullContinuation | null | undefined,
): boolean {
  if (!left || !right) return left == null && right == null;
  return (
    left.commitLsn === right.commitLsn &&
    left.commitLsnMode === right.commitLsnMode &&
    left.cursor === right.cursor &&
    baselineGroupRunsEqual(left.baselineGroupRun, right.baselineGroupRun)
  );
}

type PersistedBaselineGroupRun = readonly [
  baselineId: string,
  nextIndex: number,
  digest: string | null,
  unapplied: 0 | 1,
];

type PersistedDocumentSyncPullContinuation = readonly [
  version: 2,
  commitLsnMode: DocumentSyncCommitLsnMode,
  commitLsn: string,
  cursor: string,
  baselineGroupRun: PersistedBaselineGroupRun | null,
];

/** Decodes a persisted run; `undefined` when it is neither a run nor null. */
function readBaselineGroupRun(
  value: unknown,
): BaselineGroupRun | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [baselineId, nextIndex, digest, unapplied] = value;
  if (
    typeof baselineId !== "string" ||
    baselineId.length === 0 ||
    typeof nextIndex !== "number" ||
    !Number.isSafeInteger(nextIndex) ||
    nextIndex < 1 ||
    (digest !== null && (typeof digest !== "string" || digest.length === 0)) ||
    (unapplied !== 0 && unapplied !== 1)
  ) {
    return undefined;
  }
  return { baselineId, digest, nextIndex, unapplied: unapplied === 1 };
}

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
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    const [version, commitLsnMode, commitLsn, cursor, run] = parsed;
    const baselineGroupRun = readBaselineGroupRun(run);
    if (
      version !== 2 ||
      baselineGroupRun === undefined ||
      !isValidCheckpoint(commitLsnMode, commitLsn) ||
      typeof commitLsn !== "string" ||
      typeof cursor !== "string" ||
      cursor.length === 0 ||
      cursor.length > MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH
    ) {
      return null;
    }
    return baselineGroupRun === null
      ? { commitLsn, commitLsnMode, cursor }
      : { baselineGroupRun, commitLsn, commitLsnMode, cursor };
  } catch {
    return null;
  }
}

/**
 * The version a pull's page is requested with: `localVersionVector`, what
 * the reader holds, except on a page that continues a rotation baseline
 * followed whole. The server leaves out of a page every update whose
 * operations the page's version holds, a baseline's segments included, and
 * a reader that began a group on a cold page may hold its later segments'
 * operations by the next one, from the ordinary updates the same pull
 * served. That page is requested with no version, so the rest of the group
 * is served and its count and digest can be checked.
 */
export function pullPageVersion<Version extends string | null | undefined>(
  localVersionVector: Version,
  continuation: DocumentSyncPullContinuation | null | undefined,
): Version | null {
  const run = continuation?.baselineGroupRun;
  return run != null && run.digest !== null ? null : localVersionVector;
}

export function serializeDocumentSyncPullContinuation(
  continuation: DocumentSyncPullContinuation | null,
): string | null {
  if (continuation === null) return null;
  const run = continuation.baselineGroupRun;
  return JSON.stringify([
    2,
    continuation.commitLsnMode,
    continuation.commitLsn,
    continuation.cursor,
    run
      ? [run.baselineId, run.nextIndex, run.digest, run.unapplied ? 1 : 0]
      : null,
  ] satisfies PersistedDocumentSyncPullContinuation);
}
