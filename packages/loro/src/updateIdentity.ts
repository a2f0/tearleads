import {
  idStrToId,
  type JsonSchema,
  LoroDoc,
  type OpId,
  type PeerID,
} from "loro-crdt";
import {
  decodeVersionVector,
  encodeVersionVector,
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "./document";
import { serializeCanonicalHistory } from "./historyCanonicalization";
import { runLoroImport } from "./importRefusal";
import { isLoroRuntimeFailure } from "./runtimeFailure";
import { type OperationSpan, operationSpans } from "./versionRange";

type Version = ReturnType<typeof decodeVersionVector>;

/**
 * What the range `[startVersion, endVersion)` of `history` depends on outside
 * itself: for each peer, the last such operation.
 */
function rangeDependencyFrontiers(
  history: JsonSchema,
  startVersion: Version,
  endVersion: Version,
): OpId[] {
  const last = new Map<PeerID, number>();
  for (const change of history.changes) {
    for (const dependencyId of change.deps) {
      const { counter, peer } = idStrToId(dependencyId);
      const rangeEnd = endVersion.get(peer);
      const rangeStart = startVersion.get(peer) ?? 0;
      const inRange =
        rangeEnd !== undefined && counter >= rangeStart && counter < rangeEnd;
      if (!inRange && counter > (last.get(peer) ?? -1)) last.set(peer, counter);
    }
  }
  return [...last].map(([peer, counter]) => ({ counter, peer }));
}

/**
 * The operations the range `[startVersion, endVersion)` of `history` builds
 * on, as `doc` holds them: everything its dependencies descend from, less
 * the range itself. Another peer's operation that a later part of the range
 * depends on can itself depend on an earlier part, so the range is cut out
 * rather than assumed absent.
 */
function rangeDependencySpans(
  doc: LoroDoc,
  history: JsonSchema,
  startVersion: Version,
  endVersion: Version,
): OperationSpan[] {
  const frontiers = rangeDependencyFrontiers(history, startVersion, endVersion);
  const spans: OperationSpan[] = [];
  for (const [peer, held] of doc.frontiersToVV(frontiers).toJSON()) {
    const end = endVersion.get(peer);
    // The range holds nothing of a peer its end does not name.
    const start = end === undefined ? held : (startVersion.get(peer) ?? 0);
    const before = Math.min(held, start);
    if (before > 0) spans.push({ id: { counter: 0, peer }, len: before });
    if (end !== undefined && held > end) {
      spans.push({ id: { counter: end, peer }, len: held - end });
    }
  }
  return spans;
}

/**
 * A scratch document holding what the range builds on and none of the range.
 * Dependencies that descend from the range wait in it, pending, until an
 * import brings the range. So whatever it then exports for the range came
 * from that import: Loro refuses a held id reused with other content, but
 * takes one reused with another commit time or message as already held, and
 * a document that held part of the range would report its own.
 */
function documentBeforeRange(doc: LoroDoc, spans: OperationSpan[]): LoroDoc {
  const before = new LoroDoc();
  if (spans.length === 0) return before;
  try {
    const dependencies = doc.export({ mode: "updates-in-range", spans });
    runLoroImport(() => before.import(dependencies));
    return before;
  } catch (error) {
    before.free();
    throw error;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Prove that an update or snapshot blob contains the document's exact
 * operations for its declared version-vector range. The blob is imported
 * into a scratch document that holds what the range builds on and none of
 * the range, and the range it then holds is compared with the document's in
 * canonical form, so the blob's encoding and the way either side groups the
 * operations do not matter, and nothing the blob says can hide behind an
 * operation the comparison already held. A Loro runtime failure
 * (`isLoroRuntimeFailure`) is thrown, not reported as a mismatch.
 */
export function updateMatchesDocumentHistory(
  doc: LoroDoc,
  update: Uint8Array,
): boolean {
  let candidate: LoroDoc | null = null;
  try {
    const metadata = getImportBlobMetadata(update);
    if (
      !satisfiesVersionVector(
        encodeVersionVector(doc),
        metadata.partialEndVersionVector,
      )
    ) {
      return false;
    }
    if (
      versionVectorsEqual(
        metadata.partialStartVersionVector,
        metadata.partialEndVersionVector,
      )
    ) {
      return false;
    }
    const startVersion = decodeVersionVector(
      metadata.partialStartVersionVector,
    );
    const endVersion = decodeVersionVector(metadata.partialEndVersionVector);
    const spans = operationSpans(startVersion, endVersion);
    if (!spans) return false;

    // Loro emits a deterministic binary update for an exact operation range.
    // Most durable tails use that current encoding, so prove them without
    // expanding large text operations through JSON. Alternate encodings fall
    // through to the canonical operation comparison below.
    if (bytesEqual(update, doc.export({ mode: "updates-in-range", spans }))) {
      return true;
    }
    const expectedRange = doc.exportJsonUpdates(
      startVersion,
      endVersion,
      false,
    );
    candidate = documentBeforeRange(
      doc,
      rangeDependencySpans(doc, expectedRange, startVersion, endVersion),
    );
    if (metadata.mode === "snapshot" || metadata.mode === "shallow-snapshot") {
      importSnapshot(candidate, update);
    } else {
      importUpdates(candidate, [update]);
    }
    return (
      satisfiesVersionVector(
        encodeVersionVector(candidate),
        metadata.partialEndVersionVector,
      ) &&
      serializeCanonicalHistory(
        candidate.exportJsonUpdates(startVersion, endVersion, false),
      ) === serializeCanonicalHistory(expectedRange)
    );
  } catch (error) {
    // The runtime failing proves nothing about the update.
    if (isLoroRuntimeFailure(error)) throw error;
    return false;
  } finally {
    candidate?.free();
  }
}
