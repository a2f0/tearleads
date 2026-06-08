import type { DocumentContentKeyTarget } from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentContentKeyTargetEnvelope } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  readCanonicalRecordPaths,
  readCanonicalRecords,
} from "../../keyingCanonicalJson";
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

export function projectionPathRecords(
  projection: ContainerWriterProjectionResponse,
): Record<string, unknown>[] {
  return readCanonicalRecords(projection.path, "Document projection path");
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

export function authorizingContainerPathRecordsForLinkSet(input: {
  operation: DocumentLinkSetMutationOperation;
  targetContainerId: string;
  writerProjection: DocumentWriterProjectionResponse;
}): Record<string, unknown>[][] {
  const paths = input.writerProjection.authorizingContainerPaths.filter(
    (projection) =>
      input.operation === "link" ||
      projectionLeafContainerId(projection) !== input.targetContainerId,
  );
  if (paths.length === 0) {
    throw new Error("Document link-set authorizing paths are missing");
  }

  return paths.map(projectionPathRecords);
}

export function authorizingContainerPathRecords(
  writerProjection: DocumentWriterProjectionResponse,
): Record<string, unknown>[][] {
  return readCanonicalRecordPaths(
    writerProjection.authorizingContainerPaths.map(
      (projection) => projection.path,
    ),
    "Document authorizing container paths",
  );
}
