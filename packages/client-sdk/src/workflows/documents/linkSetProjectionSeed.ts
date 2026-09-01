import type {
  AccessManifestBundleWireResponse,
  ContainerWriterProjectionResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import type { DocumentLinkSetMutationOperation } from "../../data/documents/shared/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

interface DocumentLinkSetProjectionSeedApi {
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void;
}

function uniqueManifestBundles(
  bundles: readonly AccessManifestBundleWireResponse[],
): AccessManifestBundleWireResponse[] {
  const byHash = new Map<string, AccessManifestBundleWireResponse>();
  for (const bundle of bundles) {
    if (!byHash.has(bundle.manifestHash)) {
      byHash.set(bundle.manifestHash, bundle);
    }
  }

  return [...byHash.values()];
}

function uniqueManifestPaths(
  paths: readonly (readonly AccessManifestBundleWireResponse[])[],
): AccessManifestBundleWireResponse[][] {
  const byLeafHash = new Map<string, AccessManifestBundleWireResponse[]>();
  for (const path of paths) {
    const leafHash = path.at(-1)?.manifestHash;
    if (!leafHash || byLeafHash.has(leafHash)) {
      continue;
    }

    byLeafHash.set(leafHash, [...path]);
  }

  return [...byLeafHash.values()];
}

function containerProjectionManifestHistory(
  projection: ContainerWriterProjectionResponse,
): AccessManifestBundleWireResponse[] {
  return projection.containerKeks.flatMap(
    (kek) => kek.containerManifestHistory,
  );
}

function documentProjectionContainerPaths(
  projection: DocumentWriterProjectionResponse,
): AccessManifestBundleWireResponse[][] {
  return uniqueManifestPaths([
    ...projection.documentManifestContainerPaths,
    ...projection.authorizingContainerPaths.map((path) => path.path),
  ]);
}

function documentProjectionContainerHistory(input: {
  priorProjection: DocumentWriterProjectionResponse;
  targetContainerProjection: ContainerWriterProjectionResponse;
}): AccessManifestBundleWireResponse[] {
  const priorContainerPaths = documentProjectionContainerPaths(
    input.priorProjection,
  );
  const priorAuthorizingContainerProjections =
    input.priorProjection.authorizingContainerPaths;

  return uniqueManifestBundles([
    ...input.priorProjection.documentContainerManifestHistory,
    ...priorContainerPaths.flat(),
    ...priorAuthorizingContainerProjections.flatMap((projection) => [
      ...projection.path,
      ...containerProjectionManifestHistory(projection),
    ]),
    ...input.targetContainerProjection.path,
    ...containerProjectionManifestHistory(input.targetContainerProjection),
  ]);
}

/**
 * Reconstruct the post-mutation writer projection from a link/unlink response.
 * The response carries the fresh manifest, content-key bundle, and KEK targets;
 * the authorizing container paths change by exactly one entry — link appends
 * the target container's projection, unlink drops it (keyed by containerId).
 * Link does not rotate the content key (only unlink does), but either way the
 * bundle/targets the next write needs come straight from the response. The
 * caller verifies this projection for internal consistency before seeding it,
 * so a wrong reconstruction is discarded rather than cached.
 */
function linkSetWriterProjectionFromResponse(input: {
  operation: DocumentLinkSetMutationOperation;
  priorProjection: DocumentWriterProjectionResponse;
  response: DocumentLinkSetMutationResponse;
  targetContainerId: string;
  targetContainerProjection: ContainerWriterProjectionResponse;
}): DocumentWriterProjectionResponse {
  // The target container's authorizing path is replaced wholesale: link adds
  // the fresh target projection back, unlink leaves it dropped.
  const retainedPaths = input.priorProjection.authorizingContainerPaths.filter(
    (path) => path.containerId !== input.targetContainerId,
  );
  const authorizingContainerPaths =
    input.operation === "link"
      ? [...retainedPaths, input.targetContainerProjection]
      : retainedPaths;
  const documentManifestContainerPaths = uniqueManifestPaths([
    ...documentProjectionContainerPaths(input.priorProjection),
    input.targetContainerProjection.path,
  ]);
  return {
    authorizingContainerPaths,
    contentKeyBundle: input.response.contentKeyBundle,
    documentId: input.response.id,
    documentContainerManifestHistory: documentProjectionContainerHistory({
      priorProjection: input.priorProjection,
      targetContainerProjection: input.targetContainerProjection,
    }),
    documentKekTargets: input.response.documentKekTargets,
    documentManifest: input.response.accessManifest,
    documentManifestContainerPaths,
    documentManifestHistory: [
      input.priorProjection.documentManifest,
      ...input.priorProjection.documentManifestHistory,
    ],
  };
}

/**
 * Reconstruct and seed the post-mutation writer projection so the first read
 * after a link/unlink resolves locally instead of a cold GET. Gates the seed on
 * the projection's internal consistency (manifest hash ↔ content-key bundle ↔
 * KEK targets ↔ linked containers); on any mismatch the seed is skipped and the
 * next read falls back to a fetch — the seed is an optimization, never a
 * correctness dependency. The expensive per-path signature re-verification is
 * deliberately not run here: the server already verified the mutation, and the
 * next read re-verifies the projection before any write.
 */
export async function seedLinkSetWriterProjection(input: {
  apiClient: DocumentLinkSetProjectionSeedApi;
  execSql?: ExecSql | undefined;
  operation: DocumentLinkSetMutationOperation;
  priorProjection: DocumentWriterProjectionResponse;
  response: DocumentLinkSetMutationResponse;
  targetContainerId: string;
  targetContainerProjection: ContainerWriterProjectionResponse;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  const projection = linkSetWriterProjectionFromResponse({
    operation: input.operation,
    priorProjection: input.priorProjection,
    response: input.response,
    targetContainerId: input.targetContainerId,
    targetContainerProjection: input.targetContainerProjection,
  });
  try {
    await assertDocumentWriterProjectionConsistent(projection, {
      execSql: input.execSql,
      trustedLocalProjection: true,
    });
  } catch {
    return;
  }
  if (input.stillCurrent?.() === false) return;
  input.apiClient.primeDocumentWriterProjection(input.response.id, projection);
}
