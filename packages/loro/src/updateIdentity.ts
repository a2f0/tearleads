import {
  idStrToId,
  type JsonSchema,
  type LoroDoc,
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

function operationSpans(
  startVersion: ReturnType<typeof decodeVersionVector>,
  endVersion: ReturnType<typeof decodeVersionVector>,
): { id: { counter: number; peer: PeerID }; len: number }[] | null {
  for (const [peer, startCounter] of startVersion.toJSON()) {
    if (startCounter > (endVersion.get(peer) ?? 0)) return null;
  }
  return [...endVersion.toJSON()].flatMap(([peer, endCounter]) => {
    const startCounter = startVersion.get(peer) ?? 0;
    return endCounter === startCounter
      ? []
      : [
          {
            id: { counter: startCounter, peer },
            len: endCounter - startCounter,
          },
        ];
  });
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
    candidate = doc.forkAt(
      rangeDependencyFrontiers(expectedRange, startVersion, endVersion),
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
  } catch {
    return false;
  } finally {
    candidate?.free();
  }
}
