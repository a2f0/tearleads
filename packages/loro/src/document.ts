import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { decodeImportBlobMeta, LoroDoc, VersionVector } from "loro-crdt";
import { serializeCanonicalHistoryValue } from "./historyCanonicalization";

function isPeerIdString(value: string): value is `${number}` {
  return /^\d+$/.test(value);
}

const MAX_POSTGRES_INTEGER = 2_147_483_647;

export class LoroImportUnresolvedDependenciesError extends Error {
  readonly importKind: "snapshot" | "updates";

  constructor(importKind: "snapshot" | "updates") {
    super(
      `import${importKind === "snapshot" ? "Snapshot" : "Updates"} received ${
        importKind === "snapshot" ? "a snapshot" : "updates"
      } with unresolved pending dependencies`,
    );
    this.name = "LoroImportUnresolvedDependenciesError";
    this.importKind = importKind;
  }
}

export interface VersionVectorSpan {
  peerId: `${number}`;
  startCounter: number;
  endCounter: number;
}

function assertSupportedVersionVectorCounter(counter: number): void {
  if (
    !Number.isInteger(counter) ||
    counter < 0 ||
    counter > MAX_POSTGRES_INTEGER
  ) {
    throw new Error(
      "Version vector counter is outside the supported integer range.",
    );
  }
}

function normalizeVersionVectorEntries(
  versionVector: VersionVector,
): Map<`${number}`, number> {
  const entries = new Map<`${number}`, number>();

  for (const [peerId, counter] of versionVector.toJSON()) {
    const normalizedPeerId = String(peerId);
    if (!isPeerIdString(normalizedPeerId)) {
      throw new Error("Version vector contains a non-numeric peer ID.");
    }
    assertSupportedVersionVectorCounter(counter);
    entries.set(normalizedPeerId, counter);
  }

  return entries;
}

export async function derivePeerId(
  seed: string | Uint8Array,
): Promise<`${number}`> {
  const bytes =
    typeof seed === "string" ? new TextEncoder().encode(seed) : seed;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice()),
  );
  const view = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  );
  const peerId = (view.getBigUint64(0, false) || 1n).toString();

  if (!isPeerIdString(peerId)) {
    throw new Error("Failed to derive a numeric peer ID.");
  }

  return peerId;
}

export async function createDocument(peerSeed: string | Uint8Array) {
  const doc = new LoroDoc();
  doc.setPeerId(await derivePeerId(peerSeed));
  return doc;
}

export function exportAllUpdates(doc: LoroDoc): Uint8Array {
  return doc.export({ mode: "update" });
}

/** Deterministic, peer-uncompressed identity for an operation-log prefix. */
export function exportFullHistoryIdentity(
  doc: LoroDoc,
  endVersion?: string,
): string {
  const history = doc.exportJsonUpdates(
    undefined,
    endVersion === undefined ? undefined : decodeVersionVector(endVersion),
    false,
  );
  const canonicalChanges = history.changes
    .map((change) => ({
      change,
      identity: serializeCanonicalHistoryValue(change),
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity))
    .map(({ change }) => change);
  return serializeCanonicalHistoryValue({
    ...history,
    changes: canonicalChanges,
  });
}

/**
 * Export a mergeable, full-history snapshot — the only snapshot form this
 * codebase produces. Every document is born with full durable history and
 * restored from it, so a partial (gc'd) export here is an invariant
 * violation, not a state to accommodate; fail loudly instead of publishing a
 * blob that could not safely merge concurrent frontiers.
 */
export function exportFullHistorySnapshot(doc: LoroDoc): Uint8Array {
  const snapshot = doc.export({ mode: "snapshot" });
  const metadata = getImportBlobMetadata(snapshot);
  if (
    metadata.mode !== "snapshot" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      emptyVersionVector(),
    )
  ) {
    throw new Error(
      "Document export lost full history; this document was restored from an incomplete source",
    );
  }
  return snapshot;
}

export function exportUpdatesSince(
  doc: LoroDoc,
  encodedVersionVector?: string | null,
): Uint8Array {
  if (!encodedVersionVector) {
    return exportAllUpdates(doc);
  }

  return doc.export({
    mode: "update",
    from: VersionVector.decode(base64ToBytes(encodedVersionVector)),
  });
}

export function encodeEncodedVersionVector(
  versionVector: VersionVector,
): string {
  return bytesToBase64(versionVector.encode());
}

export function encodeVersionVector(doc: LoroDoc): string {
  return encodeEncodedVersionVector(doc.oplogVersion());
}

export function emptyVersionVector(): string {
  return encodeEncodedVersionVector(new VersionVector(undefined));
}

export function decodeVersionVector(
  encodedVersionVector: string | null | undefined,
): VersionVector {
  if (!encodedVersionVector) {
    return new VersionVector(undefined);
  }

  return VersionVector.decode(base64ToBytes(encodedVersionVector));
}

export function getUpdateVersionVectors(update: Uint8Array): {
  partialStartVersionVector: string;
  partialEndVersionVector: string;
} {
  const metadata = getImportBlobMetadata(update);

  return {
    partialStartVersionVector: metadata.partialStartVersionVector,
    partialEndVersionVector: metadata.partialEndVersionVector,
  };
}

export type ImportBlobMode =
  | "outdated-update"
  | "snapshot"
  | "shallow-snapshot"
  | "update"
  | "outdated-snapshot";

export function getImportBlobMetadata(update: Uint8Array): {
  mode: ImportBlobMode;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
} {
  const metadata = decodeImportBlobMeta(update, true);

  return {
    mode: metadata.mode,
    partialStartVersionVector: encodeEncodedVersionVector(
      metadata.partialStartVersionVector,
    ),
    partialEndVersionVector: encodeEncodedVersionVector(
      metadata.partialEndVersionVector,
    ),
  };
}

export function satisfiesVersionVector(
  encodedVersionVector: string | null | undefined,
  partialVersionVector: string,
): boolean {
  const versionVector = decodeVersionVector(encodedVersionVector);
  const requiredVersionVector = decodeVersionVector(partialVersionVector);

  for (const [peerId, counter] of requiredVersionVector.toJSON()) {
    if ((versionVector.get(peerId) ?? 0) < counter) {
      return false;
    }
  }

  return true;
}

export function mergeVersionVectors(
  encodedVersionVectors: ReadonlyArray<string>,
): string {
  const merged = new Map<`${number}`, number>();

  for (const encodedVersionVector of encodedVersionVectors) {
    for (const [normalizedPeerId, counter] of normalizeVersionVectorEntries(
      decodeVersionVector(encodedVersionVector),
    )) {
      merged.set(
        normalizedPeerId,
        Math.max(merged.get(normalizedPeerId) ?? 0, counter),
      );
    }
  }

  return encodeEncodedVersionVector(VersionVector.parseJSON(merged));
}

export function listVersionVectorSpans(input: {
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}): VersionVectorSpan[] {
  const startEntries = normalizeVersionVectorEntries(
    decodeVersionVector(input.partialStartVersionVector),
  );
  const endEntries = normalizeVersionVectorEntries(
    decodeVersionVector(input.partialEndVersionVector),
  );
  const spans: VersionVectorSpan[] = [];

  for (const [peerId, startCounter] of startEntries) {
    const endCounter = endEntries.get(peerId) ?? 0;
    if (startCounter > endCounter) {
      throw new Error("Version vector end must cover start.");
    }
  }

  for (const [peerId, endCounter] of endEntries) {
    const startCounter = startEntries.get(peerId) ?? 0;
    if (endCounter <= startCounter) {
      continue;
    }

    spans.push({ peerId, startCounter, endCounter });
  }

  return spans.sort((left, right) => left.peerId.localeCompare(right.peerId));
}

export function versionVectorsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftEntries = decodeVersionVector(left).toJSON();
  const rightEntries = decodeVersionVector(right).toJSON();

  if (leftEntries.size !== rightEntries.size) {
    return false;
  }

  for (const [peerId, leftCounter] of leftEntries) {
    if (rightEntries.get(peerId) !== leftCounter) {
      return false;
    }
  }

  return true;
}

export function importUpdates(doc: LoroDoc, updates: Uint8Array[]): void {
  const status = doc.importBatch(updates);
  if (status.pending != null && status.pending.size > 0) {
    // importBatch applies out-of-order batches correctly but can still report
    // the intermediate pending set it saw mid-batch. Trust the document, not
    // the report: the import only genuinely failed when the document's final
    // version does not cover some batched update's end version.
    const documentVersion = encodeVersionVector(doc);
    const covered = updates.every((update) =>
      satisfiesVersionVector(
        documentVersion,
        getImportBlobMetadata(update).partialEndVersionVector,
      ),
    );
    if (!covered) {
      throw new LoroImportUnresolvedDependenciesError("updates");
    }
  }
}

/**
 * Load a snapshot blob into a document. Snapshots MUST go through a single
 * `import()`, never `importBatch()`. A non-empty `pending` means the import
 * target is incompatible or dependencies are missing, so fail loudly instead
 * of silently loading a short document.
 */
export function importSnapshot(doc: LoroDoc, snapshot: Uint8Array): void {
  const status = doc.import(snapshot);
  // Reject only a genuinely incomplete import: `pending` can be an empty
  // VersionVector (size 0) rather than null when everything resolved, so test
  // for at least one unresolved dependency instead of mere presence.
  if (status.pending != null && status.pending.size > 0) {
    throw new LoroImportUnresolvedDependenciesError("snapshot");
  }
}

export function getTextValue(doc: LoroDoc, key = "text"): string {
  return doc.getText(key).toString();
}

export interface TextCharOpId {
  /** Peer of the op that inserted this character. */
  peerId: `${number}`;
  /** Counter of that op — identifies the character within the peer's stream. */
  counter: number;
}

export interface TextCharBlameSource {
  /** One entry per Unicode code point of the prose, in document order. */
  codePoints: string[];
  /** The op id that inserted each code point — same length and order as `codePoints`. */
  opIds: TextCharOpId[];
}

/**
 * Walk a LoroText's prose once, collecting each Unicode code point alongside the
 * op id `(peerId, counter)` of the op that inserted it. The two arrays share an
 * index, so callers can both blame and re-render the prose (the per-range view)
 * from a single pass.
 *
 * One Loro op (one counter) is one code point, but an astral character (emoji,
 * etc.) spans two UTF-16 units. We therefore iterate code points and index
 * `getCursor` by each code point's LAST UTF-16 unit: a leading high-surrogate
 * position yields no cursor (so iterating raw UTF-16 units would throw on prose
 * that opens with an emoji), but the low/last unit always resolves to the
 * inserting op — and using one position per code point avoids double-counting
 * the two halves of a surrogate pair.
 */
function collectTextCharBlame(doc: LoroDoc, key: string): TextCharBlameSource {
  const text = doc.getText(key);
  const codePoints: string[] = [];
  const opIds: TextCharOpId[] = [];
  let utf16End = 0;
  for (const char of text.toString()) {
    utf16End += char.length;
    // getCursor mints a WASM-backed Cursor each call; free it immediately after
    // reading its op id so a long document does not pile up cursors on the heap.
    const cursor = text.getCursor(utf16End - 1, 1);
    const opId = cursor?.pos();
    cursor?.free();
    if (opId === undefined) {
      throw new Error(
        `LoroText "${key}" code point ending at UTF-16 index ${utf16End - 1} has no op id.`,
      );
    }
    codePoints.push(char);
    opIds.push({ peerId: opId.peer, counter: opId.counter });
  }
  return { codePoints, opIds };
}

/**
 * Per-character op-id attribution for a LoroText container's prose. Returns one
 * `(peerId, counter)` per Unicode code point — the op that inserted that
 * character — in document order; the array length equals the code-point count
 * (`[...text].length`). This is the client-side primitive for character-level
 * "blame": each op id resolves to a writer by intersecting it against the
 * document's edit-attribution segments.
 */
export function listTextCharOpIds(doc: LoroDoc, key = "text"): TextCharOpId[] {
  return collectTextCharBlame(doc, key).opIds;
}

/**
 * {@link listTextCharOpIds} for a persisted snapshot blob, without opening an
 * editor: rebuilds a throwaway read-only `LoroDoc` from the snapshot and reads
 * each character's op id, so blame is exact. The doc is only read, never
 * edited, so no peer id is set.
 *
 * Extraction is linear: `getCursor()` is an O(log n) b-tree lookup per code
 * point (measured ~1.8µs/char — ~90ms for a 50k-char snapshot, flat per char and
 * unaffected by tombstones). `maxCharacters` (UTF-16 length) is therefore a soft
 * guard against pathologically large prose, not a quadratic cliff: over it we
 * return `null` ("skipped, too large", distinct from `[]` for an empty document)
 * rather than do unbounded synchronous work on the render thread.
 */
export function listSnapshotCharOpIds(
  snapshot: Uint8Array,
  maxCharacters: number,
  key = "text",
): TextCharOpId[] | null {
  const source = listSnapshotCharBlameSource(snapshot, maxCharacters, key);
  return source === null ? null : source.opIds;
}

/**
 * {@link listSnapshotCharBlameSource} is {@link listSnapshotCharOpIds} that also
 * returns each code point's text, so a caller can render the prose tinted by
 * writer (the per-range "blame" view) without a second snapshot reconstruction.
 * Same linear cost and `maxCharacters` guard.
 */
export function listSnapshotCharBlameSource(
  snapshot: Uint8Array,
  maxCharacters: number,
  key = "text",
): TextCharBlameSource | null {
  const doc = new LoroDoc();
  try {
    importSnapshot(doc, snapshot);
    if (doc.getText(key).length > maxCharacters) {
      return null;
    }
    return collectTextCharBlame(doc, key);
  } finally {
    // The throwaway doc is WASM-backed and never returned — free it immediately
    // rather than waiting for GC, since blame rebuilds one per Info-panel load.
    doc.free();
  }
}

export interface FieldEditor {
  /** The map key (e.g. `firstName`, `cardNumber`) of a structured document field. */
  key: string;
  /** Peer of the op that last set this field, or null if none is recorded. */
  peerId: `${number}` | null;
}

/**
 * The structured-document counterpart to {@link listSnapshotCharBlameSource}:
 * for a persisted snapshot, name the peer that last wrote each key of a LoroMap
 * (the document's `fields` map). Structured documents (contacts, cards, licenses)
 * store each field as a `LoroMap` entry — a last-writer-wins register that keeps
 * the setting op's peer, which `getLastEditor` reads. That peer resolves to a
 * writer via the same attribution segments,
 * giving per-field "blame". Fields carry only the peer (no op counter), so
 * resolution is peer-level. A note (or any document without this map) yields an
 * empty array. Reconstructing the small map is cheap, so there is no size cap.
 */
export function listSnapshotFieldEditors(
  snapshot: Uint8Array,
  mapKey: string,
): FieldEditor[] {
  const doc = new LoroDoc();
  try {
    importSnapshot(doc, snapshot);
    const map = doc.getMap(mapKey);
    return map.keys().map((key) => ({
      key,
      peerId: map.getLastEditor(key) ?? null,
    }));
  } finally {
    doc.free();
  }
}
