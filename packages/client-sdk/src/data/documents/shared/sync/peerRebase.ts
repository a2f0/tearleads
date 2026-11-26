import {
  type createDocument,
  decodeVersionVector,
  encodeVersionVectorCounters,
  listVersionVectorSpans,
} from "@tearleads/loro";

type RebaseDocument = Awaited<ReturnType<typeof createDocument>>;
type DocumentVersion = ReturnType<RebaseDocument["oplogVersion"]>;
type DocumentChange = ReturnType<RebaseDocument["getChangeAt"]>;

/** Per-peer operation counters; a peer that is absent counts as zero. */
export type PeerCounters = ReadonlyMap<string, number>;

/**
 * The rebase would cut an operation this device knows is committed although
 * every named frontier covers what it knows. Only a forged committed
 * operation, one that depends on an operation nobody committed, gets here:
 * a server that checks dependencies commits none, and a frontier that fell
 * is reported as `history_regressed` before anything is cut. Writing
 * committed content again under a fresh peer would duplicate it for every
 * reader, so the rebase refuses.
 */
export class PeerRebaseCommittedCutError extends Error {
  constructor(
    readonly peerId: string,
    readonly keptCounter: number,
    readonly committedCounter: number,
  ) {
    super(
      `Peer rebase would cut committed operations on peer ${peerId} (keeps ${keptCounter} of ${committedCounter} committed)`,
    );
    this.name = "PeerRebaseCommittedCutError";
  }
}

/** The fork's content differs from the live document's. */
class PeerRebaseContentMismatchError extends Error {
  constructor() {
    super(
      "Peer rebase produced a document whose content differs from the live one",
    );
    this.name = "PeerRebaseContentMismatchError";
  }
}

export interface PeerRebaseInput {
  /** The live document. Its open transaction is committed first. */
  readonly live: RebaseDocument;
  /** The fresh peer that writes the cut operations again. */
  readonly newPeer: `${number}`;
  /**
   * The committed frontier F the server named for each refused peer. A peer
   * it did not name is never cut for itself: a committed operation written
   * again under another peer would duplicate its content.
   */
  readonly refusedFrontiers: PeerCounters;
  /**
   * Per peer, the version before any operation this device has not sent: the
   * minimum of its pending base and every queued update's start. The fork's
   * update starts here.
   */
  readonly unsentStart: PeerCounters;
  /**
   * Per peer, what a sync settlement showed the server to hold: the record's
   * committed version (`countersOf`). It passes `unsentStart` where the queue
   * sends committed operations again, and `knownCommittedOf` then counts
   * them committed whatever the queue holds.
   */
  readonly committedVersion: PeerCounters;
}

export type PeerRebase =
  | { readonly kind: "nothing_to_cut" }
  | {
      /**
       * The server named a frontier below what this device knows is
       * committed. A server's frontier falls only when a billing purge
       * deletes the document and its owner recreates it from a copy that
       * lacks those operations. Nothing is cut: the operations past the
       * frontier include committed ones, which other devices still hold
       * under their own ids.
       */
      readonly kind: "history_regressed";
      /** What this device knows is committed, on every peer it holds. */
      readonly knownCommitted: PeerCounters;
      /** F on each named peer whose frontier fell. */
      readonly regressedFrontiers: PeerCounters;
    }
  | {
      readonly kind: "rebased";
      /** What this device knows is committed, on every peer it holds. */
      readonly knownCommitted: PeerCounters;
      /** The live content on `newPeer`, over the kept operations K. */
      readonly fork: RebaseDocument;
      /** K: the largest causally closed version below the refused frontiers. */
      readonly keptVersion: PeerCounters;
      /**
       * B: the version before any operation the fork has not sent, per peer
       * the minimum of K and `unsentStart`. The fork's update from B carries
       * every unsent operation, and every peer it extends is `newPeer`'s or
       * not refused.
       */
      readonly unsentBase: PeerCounters;
      /** The fork's operations after B, as one Loro update. */
      readonly update: Uint8Array;
    };

function counters(version: DocumentVersion): Map<string, number> {
  return new Map(version.toJSON());
}

/** The per-peer counters of an encoded version vector; none when absent. */
export function countersOf(
  encoded: string | null | undefined,
): Map<string, number> {
  return encoded ? counters(decodeVersionVector(encoded)) : new Map();
}

function lowerTo(
  start: Map<string, number>,
  peer: string,
  counter: number,
): void {
  start.set(peer, Math.min(start.get(peer) ?? counter, counter));
}

/**
 * Per peer of `liveVersion`, the version before any operation a device has
 * not sent: the smallest of its pending bases (a peer a base leaves out
 * starts at zero), lowered to the start of every queued update that writes
 * on the peer. Lower is safe: the fork's update then sends more of what is
 * already committed. Everything below it is committed, but not only that:
 * a queued update may send committed operations again, and the record's
 * committed version says which (`knownCommittedOf`).
 */
export function unsentStartOf(input: {
  readonly liveVersion: string;
  readonly pendingBases: readonly (string | null | undefined)[];
  readonly queued: readonly {
    readonly partialEndVersionVector: string;
    readonly partialStartVersionVector: string;
  }[];
}): Map<string, number> {
  const start = countersOf(input.liveVersion);
  for (const encoded of input.pendingBases) {
    const base = countersOf(encoded);
    for (const peer of [...start.keys()])
      lowerTo(start, peer, base.get(peer) ?? 0);
  }
  for (const row of input.queued) {
    const rowStart = countersOf(row.partialStartVersionVector);
    for (const [peer, end] of countersOf(row.partialEndVersionVector)) {
      const from = rowStart.get(peer) ?? 0;
      if (end > from) lowerTo(start, peer, from);
    }
  }
  return start;
}

/** An update's declared span: the counters it starts and ends at per peer. */
export interface CommittedUpdateSpan {
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

/**
 * The version a set of committed updates proves the server holds, for the
 * record's committed version: per peer, the highest end of a span one of
 * them carries. A peer an update names without carrying an operation on it
 * proves nothing. Null when they carry no operation at all.
 */
export function committedSpansVersion(
  updates: readonly CommittedUpdateSpan[],
): string | null {
  const ends: Record<string, number> = {};
  for (const update of updates) {
    for (const span of listVersionVectorSpans(update)) {
      ends[span.peerId] = Math.max(ends[span.peerId] ?? 0, span.endCounter);
    }
  }
  return Object.keys(ends).length === 0
    ? null
    : encodeVersionVectorCounters(ends);
}

export function versionOf(peerCounters: PeerCounters): DocumentVersion {
  return decodeVersionVector(
    encodeVersionVectorCounters(Object.fromEntries(peerCounters)),
  );
}

/** A = min(live, F) on each refused peer; every other peer stays whole. */
function refusedCut(
  liveVersion: PeerCounters,
  refusedFrontiers: PeerCounters,
): Map<string, number> {
  const kept = new Map(liveVersion);
  for (const [peer, frontier] of refusedFrontiers) {
    const end = liveVersion.get(peer);
    if (end !== undefined && frontier < end) kept.set(peer, frontier);
  }
  return kept;
}

function opLamport(doc: RebaseDocument, peer: string, counter: number) {
  const change = doc.getChangeAt({ peer: asPeerId(peer), counter });
  return change.lamport + (counter - change.counter);
}

function isPeerId(peer: string): peer is `${number}` {
  return /^\d+$/u.test(peer);
}

/** A Loro peer id from its decimal string; throws on anything else. */
export function asPeerId(peer: string): `${number}` {
  if (!isPeerId(peer)) throw new Error("Peer id must be numeric");
  return peer;
}

/** The smallest Lamport timestamp of any cut operation, or null. */
function smallestCutLamport(
  doc: RebaseDocument,
  liveVersion: PeerCounters,
  kept: PeerCounters,
): number | null {
  let smallest: number | null = null;
  for (const [peer, end] of liveVersion) {
    const keptCounter = kept.get(peer) ?? 0;
    if (keptCounter >= end) continue;
    const lamport = opLamport(doc, peer, keptCounter);
    smallest = smallest === null ? lamport : Math.min(smallest, lamport);
  }
  return smallest;
}

/**
 * Every kept change that could depend on a cut operation: those above the
 * smallest cut Lamport timestamp, walked back from each peer's kept end. A
 * change's later operations depend only on its earlier ones, so a change
 * whose first operation is at or below that timestamp cannot.
 */
function changesAboveLamport(
  doc: RebaseDocument,
  kept: PeerCounters,
  lamport: number,
): DocumentChange[] {
  const changes: DocumentChange[] = [];
  for (const [peer, keptCounter] of kept) {
    let counter = keptCounter - 1;
    while (counter >= 0) {
      const change = doc.getChangeAt({ peer: asPeerId(peer), counter });
      if (change.lamport <= lamport) break;
      changes.push(change);
      counter = change.counter - 1;
    }
  }
  return changes.sort((left, right) => left.lamport - right.lamport);
}

/**
 * Lower `kept` to the largest causally closed version below it. A kept change
 * is cut, with every later change on its peer, when a direct dependency is
 * cut. In ascending Lamport order every dependency is decided before the
 * changes that depend on it, and a change after a cut one on its own peer is
 * already past that peer's lowered end.
 */
function closeCut(
  doc: RebaseDocument,
  liveVersion: PeerCounters,
  kept: Map<string, number>,
): void {
  const lamport = smallestCutLamport(doc, liveVersion, kept);
  if (lamport === null) return;
  for (const change of changesAboveLamport(doc, kept, lamport)) {
    if (change.counter >= (kept.get(change.peer) ?? 0)) continue;
    const tainted = change.deps.some(
      (dependency) => dependency.counter >= (kept.get(dependency.peer) ?? 0),
    );
    if (tainted) kept.set(change.peer, change.counter);
  }
}

/**
 * What the device knows is committed on each peer it holds, and never past
 * the live document; this is the one place that clamps it. It has two
 * parts. An operation enters a record from the server or from a local
 * write, and a local write stays queued until the server acknowledges it,
 * so everything below `unsentStart` is committed. The queue can also send
 * committed operations again: a relay and a republished history each
 * start a peer at counter zero. For those the
 * record's committed version decides, so no queued update lowers what a
 * settlement showed.
 */
function knownCommittedOf(
  liveVersion: PeerCounters,
  committedVersion: PeerCounters,
  unsentStart: PeerCounters,
): Map<string, number> {
  const known = new Map<string, number>();
  for (const [peer, end] of liveVersion) {
    const committed = Math.max(
      committedVersion.get(peer) ?? 0,
      unsentStart.get(peer) ?? 0,
    );
    known.set(peer, Math.min(end, committed));
  }
  return known;
}

/** F on each refused peer the device knows is committed past F. */
function regressedFrontiers(
  refusedFrontiers: PeerCounters,
  committed: PeerCounters,
): Map<string, number> {
  const regressed = new Map<string, number>();
  for (const [peer, frontier] of refusedFrontiers) {
    if (frontier < (committed.get(peer) ?? 0)) regressed.set(peer, frontier);
  }
  return regressed;
}

/**
 * C: what this device knows is committed. On a refused peer it is the
 * frontier the server named, which is no lower than what the device knows
 * or the rebase would have reported a regression; on every other peer, what
 * the device knows. The closure must keep every operation below it.
 */
function assertKeepsCommitted(
  refusedFrontiers: PeerCounters,
  knownCommitted: PeerCounters,
  liveVersion: PeerCounters,
  kept: PeerCounters,
): void {
  for (const [peer, end] of liveVersion) {
    const committed = Math.min(
      refusedFrontiers.get(peer) ?? knownCommitted.get(peer) ?? 0,
      end,
    );
    const keptCounter = kept.get(peer) ?? 0;
    if (keptCounter < committed) {
      throw new PeerRebaseCommittedCutError(peer, keptCounter, committed);
    }
  }
}

function minimumCounters(
  kept: PeerCounters,
  unsentStart: PeerCounters,
): Map<string, number> {
  const base = new Map<string, number>();
  for (const [peer, keptCounter] of kept) {
    base.set(peer, Math.min(keptCounter, unsentStart.get(peer) ?? 0));
  }
  return base;
}

/** JSON with object keys sorted, so equal content serializes equally. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : nested,
  );
}

function forkOnFreshPeer(
  live: RebaseDocument,
  kept: PeerCounters,
  newPeer: `${number}`,
): RebaseDocument {
  const keptFrontiers = live.vvToFrontiers(versionOf(kept));
  const fork = live.forkAt(keptFrontiers);
  try {
    fork.setPeerId(newPeer);
    fork.applyDiff(live.diff(keptFrontiers, live.oplogFrontiers(), false));
    fork.commit();
    if (canonicalJson(fork.toJSON()) !== canonicalJson(live.toJSON())) {
      throw new PeerRebaseContentMismatchError();
    }
    return fork;
  } catch (error) {
    fork.free();
    throw error;
  }
}

/**
 * Rebase the live document's operations the server refused onto a fresh
 * peer. A frontier below what the device knows is committed means the
 * server's history went backwards; the rebase reports that and cuts
 * nothing. Otherwise it cuts each refused peer at its committed frontier,
 * then cuts every operation that depends on a cut one, and writes the cut
 * operations' net effect again under `newPeer` on a fork of what is kept. A
 * forged committed operation may depend on a cut one; it is committed, so
 * the rebase throws instead of writing it again.
 */
export function rebaseOntoFreshPeer(input: PeerRebaseInput): PeerRebase {
  const { live, newPeer } = input;
  live.commit();
  const liveVersion = counters(live.oplogVersion());
  const knownCommitted = knownCommittedOf(
    liveVersion,
    input.committedVersion,
    input.unsentStart,
  );
  const regressed = regressedFrontiers(input.refusedFrontiers, knownCommitted);
  if (regressed.size > 0) {
    return {
      kind: "history_regressed",
      knownCommitted,
      regressedFrontiers: regressed,
    };
  }
  if ((liveVersion.get(newPeer) ?? 0) > 0) {
    throw new Error("Peer rebase target already writes this document");
  }
  const kept = refusedCut(liveVersion, input.refusedFrontiers);
  closeCut(live, liveVersion, kept);
  assertKeepsCommitted(
    input.refusedFrontiers,
    knownCommitted,
    liveVersion,
    kept,
  );
  if ([...liveVersion].every(([peer, end]) => kept.get(peer) === end)) {
    return { kind: "nothing_to_cut" };
  }
  const fork = forkOnFreshPeer(live, kept, newPeer);
  const unsentBase = minimumCounters(kept, input.unsentStart);
  return {
    fork,
    keptVersion: kept,
    kind: "rebased",
    knownCommitted,
    unsentBase,
    update: fork.export({ from: versionOf(unsentBase), mode: "update" }),
  };
}
