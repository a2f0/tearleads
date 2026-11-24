import {
  type createDocument,
  decodeVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";

type RebaseDocument = Awaited<ReturnType<typeof createDocument>>;
type DocumentVersion = ReturnType<RebaseDocument["oplogVersion"]>;
type DocumentChange = ReturnType<RebaseDocument["getChangeAt"]>;

/** Per-peer operation counters; a peer that is absent counts as zero. */
export type PeerCounters = ReadonlyMap<string, number>;

/**
 * The rebase would cut an operation this device knows is committed. Honest
 * histories never get here: a committed operation depends only on committed
 * operations, and the cut holds none. Re-expressing committed content under
 * a fresh peer would duplicate it for every reader, so the rebase refuses.
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
   * minimum of its pending base and every queued update's start. Everything
   * below it is committed.
   */
  readonly unsentStart: PeerCounters;
}

export type PeerRebase =
  | { readonly kind: "nothing_to_cut" }
  | {
      readonly kind: "rebased";
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

function encodedCounters(encoded: string | null | undefined) {
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
 * on the peer. Lower is safe: the rebase then sends more of what is already
 * committed and trusts less of it as committed.
 */
export function unsentStartOf(input: {
  readonly liveVersion: string;
  readonly pendingBases: readonly (string | null | undefined)[];
  readonly queued: readonly {
    readonly partialEndVersionVector: string;
    readonly partialStartVersionVector: string;
  }[];
}): Map<string, number> {
  const start = encodedCounters(input.liveVersion);
  for (const encoded of input.pendingBases) {
    const base = encodedCounters(encoded);
    for (const peer of [...start.keys()])
      lowerTo(start, peer, base.get(peer) ?? 0);
  }
  for (const row of input.queued) {
    const rowStart = encodedCounters(row.partialStartVersionVector);
    for (const [peer, end] of encodedCounters(row.partialEndVersionVector)) {
      const from = rowStart.get(peer) ?? 0;
      if (end > from) lowerTo(start, peer, from);
    }
  }
  return start;
}

function versionOf(peerCounters: PeerCounters): DocumentVersion {
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

function asPeerId(peer: string): `${number}` {
  if (!/^\d+$/u.test(peer)) throw new Error("Peer id must be numeric");
  return peer as `${number}`;
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
 * C: what this device knows is committed. On a refused peer it is the
 * frontier the server named; on every other peer, the start of the unsent
 * operations. The closure must keep every operation below it.
 */
function assertKeepsCommitted(
  input: PeerRebaseInput,
  liveVersion: PeerCounters,
  kept: PeerCounters,
): void {
  for (const [peer, end] of liveVersion) {
    const committed =
      input.refusedFrontiers.get(peer) ?? input.unsentStart.get(peer) ?? 0;
    const keptCounter = kept.get(peer) ?? 0;
    if (keptCounter < Math.min(committed, end)) {
      throw new PeerRebaseCommittedCutError(
        peer,
        keptCounter,
        Math.min(committed, end),
      );
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
 * peer. Cuts each refused peer at its committed frontier, then cuts every
 * operation that depends on a cut one, and writes the cut operations' net
 * effect again under `newPeer` on a fork of what is kept. Before the server
 * checks dependencies, a forged committed operation may depend on a cut one;
 * it is committed, so the rebase throws instead of writing it again.
 */
export function rebaseOntoFreshPeer(input: PeerRebaseInput): PeerRebase {
  const { live, newPeer } = input;
  live.commit();
  const liveVersion = counters(live.oplogVersion());
  if ((liveVersion.get(newPeer) ?? 0) > 0) {
    throw new Error("Peer rebase target already writes this document");
  }
  const kept = refusedCut(liveVersion, input.refusedFrontiers);
  closeCut(live, liveVersion, kept);
  assertKeepsCommitted(input, liveVersion, kept);
  if ([...liveVersion].every(([peer, end]) => kept.get(peer) === end)) {
    return { kind: "nothing_to_cut" };
  }
  const fork = forkOnFreshPeer(live, kept, newPeer);
  const unsentBase = minimumCounters(kept, input.unsentStart);
  return {
    fork,
    keptVersion: kept,
    kind: "rebased",
    unsentBase,
    update: fork.export({ from: versionOf(unsentBase), mode: "update" }),
  };
}
