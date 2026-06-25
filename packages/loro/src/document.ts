import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { decodeImportBlobMeta, LoroDoc, VersionVector } from "loro-crdt";

function isPeerIdString(value: string): value is `${number}` {
  return /^\d+$/.test(value);
}

const MAX_POSTGRES_INTEGER = 2_147_483_647;

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

/**
 * Export a state-only shallow snapshot at the current frontier: history before
 * "now" is trimmed, so the blob is bounded by document STATE rather than by the
 * full op history. Use this for the LOCAL persisted snapshot (it stays an order
 * of magnitude smaller and stops growing per keystroke). Never put a shallow
 * snapshot on the wire — peers reconstruct from updates, and it carries no
 * replayable history below the cut.
 */
export function exportShallowSnapshot(doc: LoroDoc): Uint8Array {
  return doc.export({
    mode: "shallow-snapshot",
    frontiers: doc.oplogFrontiers(),
  });
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
  const metadata = decodeImportBlobMeta(update, true);

  return {
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
  doc.importBatch(updates);
}

/**
 * Load a (possibly shallow) snapshot blob into a document. Snapshots MUST go
 * through a single `import()`, never `importBatch()`: importBatch silently drops
 * a shallow snapshot when the target already holds state, whereas import()
 * merges it correctly. A non-empty `pending` means the blob referenced ops we
 * never received, so we fail loudly instead of silently loading a short document.
 */
export function importSnapshot(doc: LoroDoc, snapshot: Uint8Array): void {
  const status = doc.import(snapshot);
  // Reject only a genuinely incomplete import: `pending` can be an empty
  // VersionVector (size 0) rather than null when everything resolved, so test
  // for at least one unresolved dependency instead of mere presence.
  if (status.pending != null && status.pending.size > 0) {
    throw new Error(
      "importSnapshot received a snapshot with unresolved pending dependencies",
    );
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

/**
 * Per-character op-id attribution for a LoroText container's prose. Returns one
 * `(peerId, counter)` per Unicode code point — the op that inserted that
 * character — in document order; the array length equals the code-point count
 * (`[...text].length`). This is the client-side primitive for character-level
 * "blame": each op id resolves to a writer by intersecting it against the
 * document's edit-attribution segments.
 *
 * One Loro op (one counter) is one code point, but an astral character (emoji,
 * etc.) spans two UTF-16 units. We therefore iterate code points and index
 * `getCursor` by each code point's LAST UTF-16 unit: a leading high-surrogate
 * position yields no cursor (so iterating raw UTF-16 units would throw on prose
 * that opens with an emoji), but the low/last unit always resolves to the
 * inserting op — and using one position per code point avoids double-counting
 * the two halves of a surrogate pair.
 */
export function listTextCharOpIds(doc: LoroDoc, key = "text"): TextCharOpId[] {
  const text = doc.getText(key);
  const opIds: TextCharOpId[] = [];
  let utf16End = 0;
  for (const char of text.toString()) {
    utf16End += char.length;
    const opId = text.getCursor(utf16End - 1, 1)?.pos();
    if (opId === undefined) {
      throw new Error(
        `LoroText "${key}" code point ending at UTF-16 index ${utf16End - 1} has no op id.`,
      );
    }
    opIds.push({ peerId: opId.peer, counter: opId.counter });
  }
  return opIds;
}
