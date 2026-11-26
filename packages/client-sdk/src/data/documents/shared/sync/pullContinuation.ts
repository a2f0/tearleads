import { compareCanonicalStrings } from "@tearleads/crypto";
import {
  isWalLsnString,
  MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH,
} from "@tearleads/validators/util";
import {
  type BaselineGroupRun,
  baselineGroupStateFromRun,
  continuesWholeBaselineGroup,
} from "./baselineGroupMachine";
import { MAX_UNAPPLIED_BASELINE_SPANS } from "./baselineGroupUnapplied";
import type { DocumentOperationSpan } from "./documentUpdateVerdict";

export type DocumentSyncCommitLsnMode = "tracked" | "untracked";

export interface DocumentSyncPullContinuation {
  /**
   * The rotation baseline the page before this cursor ended inside; absent
   * or null when it ended outside one. The next page checks the baseline's
   * remaining segments against it (`judgeServedBaselineGroups`), and is
   * requested with no version while the baseline is followed whole
   * (`pullPageRequest`).
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

function operationSpansEqual(
  left: DocumentOperationSpan,
  right: DocumentOperationSpan | undefined,
): boolean {
  return (
    right !== undefined &&
    left.peerId === right.peerId &&
    left.startCounter === right.startCounter &&
    left.endCounter === right.endCounter
  );
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
    left.unapplied.length === right.unapplied.length &&
    left.unapplied.every((span, index) =>
      operationSpansEqual(span, right.unapplied[index]),
    )
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

type PersistedOperationSpan = readonly [
  peerId: string,
  startCounter: number,
  endCounter: number,
];

type PersistedBaselineGroupRun = readonly [
  baselineId: string,
  nextIndex: number,
  digest: string | null,
  unapplied: readonly PersistedOperationSpan[],
];

/**
 * The format of a stored continuation. A reader takes only its own: a
 * continuation stored in another format restarts its pull from page one.
 * Format 3 stores a run's unapplied operations as one span a peer.
 */
const PULL_CONTINUATION_FORMAT = 3;

type PersistedDocumentSyncPullContinuation = readonly [
  version: typeof PULL_CONTINUATION_FORMAT,
  commitLsnMode: DocumentSyncCommitLsnMode,
  commitLsn: string,
  cursor: string,
  baselineGroupRun: PersistedBaselineGroupRun | null,
];

const MAX_PEER_ID = 18_446_744_073_709_551_615n;

/**
 * Whether `value` is a Loro peer id as Loro writes one: an unsigned 64-bit
 * integer in decimal with no leading zero. Spans are kept one a peer, in
 * peer order, by this string, so another spelling of a peer would be
 * another peer.
 */
function isCanonicalPeerId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,19})$/u.test(value) &&
    BigInt(value) <= MAX_PEER_ID
  );
}

function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Decodes a persisted run's unapplied operations: at most
 * `MAX_UNAPPLIED_BASELINE_SPANS` spans that each hold at least one
 * operation, one a canonical peer id, in peer order. Null when they are
 * anything else.
 */
function readUnappliedOperations(
  value: unknown,
): DocumentOperationSpan[] | null {
  if (!Array.isArray(value) || value.length > MAX_UNAPPLIED_BASELINE_SPANS) {
    return null;
  }
  const spans: DocumentOperationSpan[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;
    const [peerId, startCounter, endCounter] = entry;
    const before = spans.at(-1);
    if (
      !isCanonicalPeerId(peerId) ||
      !isCounter(startCounter) ||
      !isCounter(endCounter) ||
      startCounter >= endCounter ||
      (before && compareCanonicalStrings(before.peerId, peerId) >= 0)
    ) {
      return null;
    }
    spans.push({ endCounter, peerId, startCounter });
  }
  return spans;
}

/** Decodes a persisted run; `undefined` when it is neither a run nor null. */
function readBaselineGroupRun(
  value: unknown,
): BaselineGroupRun | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [baselineId, nextIndex, digest] = value;
  const unapplied = readUnappliedOperations(value[3]);
  if (
    typeof baselineId !== "string" ||
    baselineId.length === 0 ||
    typeof nextIndex !== "number" ||
    !Number.isSafeInteger(nextIndex) ||
    nextIndex < 1 ||
    (digest !== null && (typeof digest !== "string" || digest.length === 0)) ||
    unapplied === null
  ) {
    return undefined;
  }
  return { baselineId, digest, nextIndex, unapplied };
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
      version !== PULL_CONTINUATION_FORMAT ||
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
 * What a pull's page is requested with: the cursor of the continuation it
 * goes on from, and the reader's version `localVersionVector`, except on a
 * page that continues a rotation baseline followed whole. The server leaves
 * out of a page every update whose operations the page's version holds, a
 * baseline's segments included, and a reader that began a group on a cold
 * page may hold its later segments' operations by the next one, from the
 * ordinary updates the same pull served. That page is requested with no
 * version, so the rest of the group is served and its count and digest can
 * be checked.
 *
 * The run is the one the judge reads, the run the page's own cursor
 * continues (`continuedBaselineGroupRun`), and the machine says whether it
 * is followed whole, so the page is judged as it was asked for.
 */
export function pullPageRequest<Version extends string | null | undefined>(
  localVersionVector: Version,
  continuation: DocumentSyncPullContinuation | null | undefined,
): {
  readonly localVersionVector: Version | null;
  readonly pullCursor: string | undefined;
} {
  const pullCursor = continuation?.cursor;
  const state = baselineGroupStateFromRun(
    continuedBaselineGroupRun(continuation, pullCursor),
  );
  return {
    localVersionVector: continuesWholeBaselineGroup(state)
      ? null
      : localVersionVector,
    pullCursor,
  };
}

export function serializeDocumentSyncPullContinuation(
  continuation: DocumentSyncPullContinuation | null,
): string | null {
  if (continuation === null) return null;
  const run = continuation.baselineGroupRun;
  return JSON.stringify([
    PULL_CONTINUATION_FORMAT,
    continuation.commitLsnMode,
    continuation.commitLsn,
    continuation.cursor,
    run
      ? [
          run.baselineId,
          run.nextIndex,
          run.digest,
          run.unapplied.map(
            (span): PersistedOperationSpan => [
              span.peerId,
              span.startCounter,
              span.endCounter,
            ],
          ),
        ]
      : null,
  ] satisfies PersistedDocumentSyncPullContinuation);
}
