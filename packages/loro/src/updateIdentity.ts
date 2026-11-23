import { idStrToId, type JsonSchema, type LoroDoc } from "loro-crdt";
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
import { isLoroRuntimeFailure } from "./runtimeFailure";
import { operationSpans } from "./versionRange";

function rangeDependencyFrontiers(
  history: JsonSchema,
  startVersion: ReturnType<typeof decodeVersionVector>,
  endVersion: ReturnType<typeof decodeVersionVector>,
) {
  const externalDependencies = new Map<string, ReturnType<typeof idStrToId>>();
  for (const change of history.changes) {
    for (const dependencyId of change.deps) {
      const dependency = idStrToId(dependencyId);
      const rangeEnd = endVersion.get(dependency.peer);
      const rangeStart = startVersion.get(dependency.peer) ?? 0;
      if (
        rangeEnd !== undefined &&
        dependency.counter >= rangeStart &&
        dependency.counter < rangeEnd
      ) {
        continue;
      }
      externalDependencies.set(dependencyId, dependency);
    }
  }
  return [...externalDependencies.values()];
}

/**
 * `range` replayed onto `doc` forked at `frontiers`. Holders of the same
 * operations can split them differently by the path that imported them, as a
 * reader holding part of a change does when a snapshot brings the rest.
 * Replayed onto one prefix, equal operations split alike, and an operation's
 * content is kept.
 */
function replayedRange(
  doc: LoroDoc,
  frontiers: ReturnType<typeof rangeDependencyFrontiers>,
  range: JsonSchema,
  startVersion: ReturnType<typeof decodeVersionVector>,
  endVersion: ReturnType<typeof decodeVersionVector>,
): string {
  const replay = doc.forkAt(frontiers);
  try {
    replay.importJsonUpdates(range);
    return serializeCanonicalHistory(
      replay.exportJsonUpdates(startVersion, endVersion, false),
    );
  } finally {
    replay.free();
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Prove that an update or snapshot blob contains the document's exact
 * operations for its declared version-vector range. Rebuild from the exact
 * prefix and compare canonical operation identity across current update and
 * snapshot forms without letting same-peer/counter conflicts hide in an import.
 * A Loro runtime failure (`isLoroRuntimeFailure`) is thrown, not reported as a
 * mismatch.
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
    const frontiers = rangeDependencyFrontiers(
      expectedRange,
      startVersion,
      endVersion,
    );
    candidate = doc.forkAt(frontiers);
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
      replayedRange(
        doc,
        frontiers,
        candidate.exportJsonUpdates(startVersion, endVersion, false),
        startVersion,
        endVersion,
      ) ===
        replayedRange(doc, frontiers, expectedRange, startVersion, endVersion)
    );
  } catch (error) {
    // The runtime failing proves nothing about the update.
    if (isLoroRuntimeFailure(error)) throw error;
    return false;
  } finally {
    candidate?.free();
  }
}
