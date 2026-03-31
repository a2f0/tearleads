import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { decodeImportBlobMeta, LoroDoc, VersionVector } from "loro-crdt";

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

// Loro accepts numeric peer IDs as strings; normalize once so callers don't
// need to care about bigint vs string representation.
function normalizePeerId(peerId: bigint): `${number}` {
  return peerId.toString() as `${number}`;
}

export async function derivePeerId(
  seed: string | Uint8Array,
): Promise<`${number}`> {
  const bytes =
    typeof seed === "string" ? new TextEncoder().encode(seed) : seed;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toBuffer(bytes)),
  );
  const view = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  );
  const peerId = view.getBigUint64(0, false) || 1n;
  return normalizePeerId(peerId);
}

export async function createDocument(peerSeed: string | Uint8Array) {
  const doc = new LoroDoc();
  doc.setPeerId(await derivePeerId(peerSeed));
  return doc;
}

export function exportAllUpdates(doc: LoroDoc): Uint8Array {
  return doc.export({ mode: "update" });
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

export function importUpdates(doc: LoroDoc, updates: Uint8Array[]): void {
  doc.importBatch(updates);
}

export function getTextValue(doc: LoroDoc, key = "text"): string {
  return doc.getText(key).toString();
}
