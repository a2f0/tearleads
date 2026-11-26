// Generated histories and the holders that reach them by different paths.
// A seed decides everything: the edits, the commit times (passed to each
// commit, never read from the clock) and how each holder was fed.
import { type Change, LoroDoc, type PeerID } from "loro-crdt";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  encodeVersionVectorCounters,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importSnapshot,
  importUpdates,
  mergeVersionVectors,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "./document";
import {
  type EditOptions,
  editDocument,
  type Next,
} from "./historyEdits.testFixtures";

/** A small deterministic generator, so a failing seed can be replayed. */
export function generator(seed: number): Next {
  let state = seed >>> 0;
  return (bound) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % bound;
  };
}

type Commit = (doc: LoroDoc, timestamp: number, message?: string) => void;

export interface HeldHistoryOptions extends EditOptions {
  readonly rounds: number;
  readonly writers: 2 | 3;
  /** Commits `doc` at `timestamp` seconds; the default passes it to Loro. */
  readonly commit?: Commit;
}

export interface HeldHistory {
  /** Each holder of the whole history, named by the path that fed it. */
  readonly holders: ReadonlyMap<string, LoroDoc>;
  /** Honest blobs of the history: uploads, a snapshot and cut segments. */
  readonly updates: ReadonlyArray<{ name: string; update: Uint8Array }>;
  free(): void;
}

function range(
  doc: LoroDoc,
  peer: PeerID,
  start: number,
  length: number,
): Uint8Array {
  return doc.export({
    mode: "updates-in-range",
    spans: [{ id: { counter: start, peer }, len: length }],
  });
}

function changesInDependencyOrder(doc: LoroDoc): Change[] {
  // A change's dependencies have smaller Lamport times.
  return [...doc.getAllChanges().values()]
    .flat()
    .sort(
      (left, right) =>
        left.lamport - right.lamport || (left.peer < right.peer ? -1 : 1),
    );
}

/** `doc`'s history as updates cut at arbitrary counters, in import order. */
function cutAnywhere(doc: LoroDoc, next: Next): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (const change of changesInDependencyOrder(doc)) {
    let start = change.counter;
    const end = change.counter + change.length;
    while (start < end) {
      const left = end - start;
      const length =
        next(3) === 0
          ? left
          : 1 + next(next(4) === 0 ? Math.min(left, 8) : left);
      pieces.push(range(doc, change.peer, start, length));
      start += length;
    }
  }
  return pieces;
}

function hasOperations(update: Uint8Array): boolean {
  const vectors = getUpdateVersionVectors(update);
  return !versionVectorsEqual(
    vectors.partialStartVersionVector,
    vectors.partialEndVersionVector,
  );
}

/**
 * Imports each update once `reader` holds what it builds on, as the sync
 * judge does, so nothing is ever left pending in it. Returns the updates
 * that never became importable.
 */
function importInDependencyOrder(
  reader: LoroDoc,
  updates: readonly Uint8Array[],
): Uint8Array[] {
  let waiting = [...updates];
  for (;;) {
    const later: Uint8Array[] = [];
    for (const update of waiting) {
      const vectors = getUpdateVersionVectors(update);
      const held = encodeVersionVector(reader);
      if (
        satisfiesVersionVector(held, vectors.dependencyVersionVector) &&
        satisfiesVersionVector(held, vectors.partialStartVersionVector)
      ) {
        importUpdates(reader, [update]);
      } else {
        later.push(update);
      }
    }
    if (later.length === waiting.length) return later;
    waiting = later;
  }
}

/** The writers of one history and what they have uploaded so far. */
interface Writing {
  clock: number;
  /** Per writer: the version its next upload starts from. */
  readonly uploaded: string[];
  readonly uploads: Uint8Array[];
  readonly writers: LoroDoc[];
}

/**
 * `base` moved past the other peers' operations that `published` carries,
 * as a device's upload base moves when it pulls: its next upload leaves
 * them out.
 */
function pastPublished(
  base: string,
  own: PeerID,
  published: readonly Uint8Array[],
): string {
  const ends = mergeVersionVectors([
    base,
    ...published.map(
      (update) => getUpdateVersionVectors(update).partialEndVersionVector,
    ),
  ]);
  const counters: Record<string, number> = {};
  for (const [peer, counter] of decodeVersionVector(ends).toJSON()) {
    counters[peer] = counter;
  }
  counters[own] = decodeVersionVector(base).get(own) ?? 0;
  return encodeVersionVectorCounters(counters);
}

/**
 * One writer syncs, edits, commits, and sometimes uploads or checkpoints.
 * Returns that writer.
 */
function writeRound(
  writing: Writing,
  next: Next,
  options: EditOptions,
  commit: Commit,
): LoroDoc {
  const { uploaded, uploads, writers } = writing;
  const which = next(writers.length);
  const writer = writers[which];
  const other =
    writers[(which + 1 + next(writers.length - 1)) % writers.length];
  if (!writer || !other) throw new Error("No writer");
  const sync = next(6);
  if (sync === 0) {
    // Straight from another writer: this writer's next upload carries those
    // operations too, repeating what the other writer uploads itself.
    importUpdates(writer, [
      exportUpdatesSince(other, encodeVersionVector(writer)),
    ]);
  } else if (sync === 1) {
    const published = uploads.filter(hasOperations);
    importUpdates(writer, published);
    uploaded[which] = pastPublished(
      uploaded[which] ?? "",
      writer.peerIdStr,
      published,
    );
  }
  for (let edits = 1 + next(4); edits > 0; edits -= 1) {
    editDocument(writer, next, options);
    if (next(3) === 0) {
      writing.clock += [0, 0, 1, 2][next(4)] ?? 0;
      commit(writer, writing.clock);
    }
  }
  // Mostly inside the merge interval, so commits share a change.
  writing.clock += [0, 0, 0, 1, 1, 2, 90][next(7)] ?? 0;
  const message = next(12) === 0 ? `message ${next(3)}` : undefined;
  commit(writer, writing.clock, message);
  if (next(3) !== 0) {
    uploads.push(exportUpdatesSince(writer, uploaded[which]));
    uploaded[which] = encodeVersionVector(writer);
  }
  // A checkpoint export regroups the writer's own operations.
  if (next(5) === 0) exportFullHistorySnapshot(writer);
  return writer;
}

/** Writers editing, committing, uploading, checkpointing and syncing. */
async function write(
  seed: number,
  next: Next,
  options: HeldHistoryOptions,
): Promise<Writing & { early: Uint8Array }> {
  const commit: Commit =
    options.commit ??
    ((doc, timestamp, message) =>
      doc.commit(
        message === undefined ? { timestamp } : { message, timestamp },
      ));
  const writers: LoroDoc[] = [];
  for (let index = 0; index < options.writers; index += 1) {
    writers.push(await createDocument(`held-${seed}-writer-${index}`));
  }
  const writing: Writing = {
    clock: 1_700_000_000 + seed,
    uploaded: writers.map(() => ""),
    uploads: [],
    writers,
  };
  let early: Uint8Array | null = null;
  for (let round = 0; round < options.rounds; round += 1) {
    const writer = writeRound(writing, next, options, commit);
    if (round === Math.floor(options.rounds / 2)) {
      early = exportFullHistorySnapshot(writer);
    }
  }
  for (const [which, writer] of writers.entries()) {
    writing.uploads.push(exportUpdatesSince(writer, writing.uploaded[which]));
  }
  for (const writer of writers) {
    for (const other of writers) {
      importUpdates(writer, [
        exportUpdatesSince(other, encodeVersionVector(writer)),
      ]);
    }
  }
  if (!early) throw new Error("No early snapshot");
  return { ...writing, early };
}

/** One generated history, held by writers and by readers of every path. */
export async function generateHeldHistory(
  seed: number,
  options: HeldHistoryOptions,
): Promise<HeldHistory> {
  const next = generator(seed * 7919 + 13);
  const written = await write(seed, next, options);
  const uploads = written.uploads.filter(hasOperations);
  const [source] = written.writers;
  if (!source) throw new Error("No writer");
  const snapshot = exportFullHistorySnapshot(source);
  const holders = new Map<string, LoroDoc>();
  for (const [index, writer] of written.writers.entries()) {
    holders.set(`writer ${index}`, writer);
  }
  const reader = (name: string, feed: (doc: LoroDoc) => void) => {
    const doc = new LoroDoc();
    holders.set(name, doc);
    feed(doc);
    return doc;
  };
  const separate = reader("separate uploads", (doc) => {
    if (importInDependencyOrder(doc, uploads).length > 0) {
      throw new Error("An upload never became importable");
    }
  });
  reader("batched uploads", (doc) => importUpdates(doc, uploads));
  reader("snapshot", (doc) => importSnapshot(doc, snapshot));
  reader("snapshot plus updates", (doc) => {
    importSnapshot(doc, written.early);
    importUpdates(doc, [exportUpdatesSince(source, encodeVersionVector(doc))]);
  });
  reader("uploads, then a snapshot", (doc) => {
    importInDependencyOrder(doc, uploads.slice(0, 1 + next(uploads.length)));
    importSnapshot(doc, snapshot);
  });
  const segments = cutAnywhere(source, next);
  reader("segments", (doc) => {
    for (const segment of segments) importUpdates(doc, [segment]);
  });
  const named = (name: string, updates: readonly Uint8Array[]) =>
    updates.map((update, index) => ({ name: `${name} ${index}`, update }));
  return {
    free: () => {
      for (const holder of holders.values()) holder.free();
    },
    holders,
    updates: [
      ...named("upload", uploads),
      ...named("snapshot", [snapshot]),
      ...named("segment", segments),
      ...named("a reader's segment", cutAnywhere(separate, next)),
    ],
  };
}
