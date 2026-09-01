import type { DocumentContentKeyTarget } from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  ContainerManifestRef,
  DocumentContentKeyTargetEnvelope,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  normalizeDocumentKekTargetResponse,
  readManifestContainerId,
  serializeCanonical,
  sortDocumentTargets,
  targetEnvelopeReference,
  targetKey,
  uniqueSortedStrings,
} from "./readers";
import type { DocumentLinkSetMutationOperation } from "./types";

export function deriveDocumentCreateTargets(
  projection: ContainerWriterProjectionResponse,
): DocumentContentKeyTarget[] {
  const targetIndex = projection.path.length - 1;
  const targetManifest = projection.path[targetIndex];
  if (!targetManifest) {
    throw new Error("Container writer projection path is empty");
  }

  if (readManifestContainerId(targetManifest) !== projection.containerId) {
    throw new Error("Container writer projection target path is inconsistent");
  }

  const targetKek = projection.containerKeks[targetIndex];
  if (!targetKek) {
    throw new Error("Container writer projection target KEK is unavailable");
  }
  if (targetKek.containerId !== projection.containerId) {
    throw new Error("Container writer projection target KEK is inconsistent");
  }
  if (targetKek.accessManifestHash !== targetManifest.manifestHash) {
    throw new Error("Container writer projection target KEK is stale");
  }

  return [
    {
      containerId: targetKek.containerId,
      containerManifestHash: targetKek.accessManifestHash,
      containerKeyEpochId: targetKek.containerKeyEpochId,
      containerKeyEpoch: targetKek.containerKeyEpoch,
    },
  ];
}

export function mergeTargetEnvelopes(
  targets: readonly DocumentContentKeyTarget[],
  envelopes: readonly DocumentContentKeyTargetEnvelope[],
): DocumentContentKeyTargetEnvelope[] {
  const expectedByKey = new Map(
    targets.map((target) => [targetKey(target), target]),
  );
  const envelopeByKey = new Map<string, DocumentContentKeyTargetEnvelope>();

  for (const envelope of envelopes) {
    const key = targetKey(envelope);
    if (!expectedByKey.has(key)) {
      throw new Error("Document content-key target envelope is unexpected");
    }
    if (envelopeByKey.has(key)) {
      throw new Error("Document content-key target envelope is duplicated");
    }
    if (envelope.wrappedKey.length === 0) {
      throw new Error("Document content-key target envelope is empty");
    }
    if (!isPlainRecord(envelope.wrappingMetadata)) {
      throw new Error(
        "Document content-key target wrapping metadata must be an object",
      );
    }
    envelopeByKey.set(key, envelope);
  }

  return sortDocumentTargets(targets).map((target) => {
    const envelope = envelopeByKey.get(targetKey(target));
    if (!envelope) {
      throw new Error("Document content-key target envelope is missing");
    }
    return envelope;
  });
}

function projectionLeafContainerId(
  projection: ContainerWriterProjectionResponse,
): string | null {
  const leafBundle = projection.path.at(-1);
  return leafBundle ? readManifestContainerId(leafBundle) : null;
}

export function describeProjectionTargetKek(
  projection: ContainerWriterProjectionResponse,
): string {
  const targetKek = projection.containerKeks.at(-1);
  const containerId =
    projectionLeafContainerId(projection) ??
    targetKek?.containerId ??
    projection.containerId;
  return targetKek
    ? `container ${containerId} epoch ${targetKek.containerKeyEpochId}`
    : `container ${containerId}`;
}

export function deriveDocumentTargetFromProjection(
  projection: ContainerWriterProjectionResponse,
): DocumentContentKeyTarget {
  const target = deriveDocumentCreateTargets(projection)[0];
  if (!target) {
    throw new Error("Document target projection is unavailable");
  }
  return target;
}

export function readLinkedContainerIdsFromDocumentManifest(
  writerProjection: DocumentWriterProjectionResponse,
): string[] {
  const state = writerProjection.documentManifest.state;
  const linkedContainerIds = isPlainRecord(state)
    ? Reflect.get(state, "linkedContainerIds")
    : undefined;
  if (
    !Array.isArray(linkedContainerIds) ||
    linkedContainerIds.some(
      (containerId) =>
        typeof containerId !== "string" || containerId.length === 0,
    )
  ) {
    throw new Error("Document link-set state is invalid");
  }

  return uniqueSortedStrings(linkedContainerIds);
}

export function currentDocumentTargets(
  writerProjection: DocumentWriterProjectionResponse,
): DocumentContentKeyTarget[] {
  const targets = normalizeDocumentKekTargetResponse(
    writerProjection.documentKekTargets,
  );
  const bundleTargets = sortDocumentTargets(
    writerProjection.contentKeyBundle.targets.map(targetEnvelopeReference),
  );

  if (
    serializeCanonical(targets, "KEK targets") !==
    serializeCanonical(bundleTargets, "content-key targets")
  ) {
    throw new Error("Document link-set content-key targets mismatch");
  }

  return targets;
}

/**
 * Reduce a single container path (root→leaf chain) to {containerId,
 * manifestHash} references. The server already stores each manifest and resolves
 * it from its own store, so a write echoes only the hashes instead of
 * re-embedding the full signed bundles it received in the writer projection.
 */
export function containerPathRefs(
  path: ContainerWriterProjectionResponse["path"],
): ContainerManifestRef[] {
  return path.map((bundle) => {
    const containerId = readManifestContainerId(bundle);
    if (!containerId) {
      throw new Error("Container path manifest is missing a container id");
    }
    return { containerId, manifestHash: bundle.manifestHash };
  });
}

export function authorizingContainerPathRefs(
  writerProjection: DocumentWriterProjectionResponse,
): ContainerManifestRef[][] {
  return writerProjection.authorizingContainerPaths.map((projection) =>
    containerPathRefs(projection.path),
  );
}

export function authorizingContainerPathRefsForLinkSet(input: {
  operation: DocumentLinkSetMutationOperation;
  targetContainerId: string;
  writerProjection: DocumentWriterProjectionResponse;
}): ContainerManifestRef[][] {
  const paths = input.writerProjection.authorizingContainerPaths.filter(
    (projection) =>
      input.operation === "link" ||
      projectionLeafContainerId(projection) !== input.targetContainerId,
  );
  if (paths.length === 0) {
    throw new Error("Document link-set authorizing paths are missing");
  }

  return paths.map((projection) => containerPathRefs(projection.path));
}
