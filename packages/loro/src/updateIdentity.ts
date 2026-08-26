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
 * Prove that an update or snapshot blob contains the document's exact
 * operations for its declared version-vector range. Rebuild from the exact
 * prefix and compare canonical operation identity so equivalent legacy/current
 * encodings pass without letting same-peer/counter conflicts hide in an import.
 */
export function updateMatchesDocumentHistory(
  doc: LoroDoc,
  update: Uint8Array,
): boolean {
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

  let candidate: LoroDoc | null = null;
  try {
    const startVersion = decodeVersionVector(
      metadata.partialStartVersionVector,
    );
    const endVersion = decodeVersionVector(metadata.partialEndVersionVector);
    const expectedRange = doc.exportJsonUpdates(
      startVersion,
      endVersion,
      false,
    );
    candidate = doc.forkAt(
      rangeDependencyFrontiers(expectedRange, startVersion, endVersion),
    );
    if (
      metadata.mode === "snapshot" ||
      metadata.mode === "outdated-snapshot" ||
      metadata.mode === "shallow-snapshot"
    ) {
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
