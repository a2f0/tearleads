import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { uniqueSortedStrings } from "../../data/documents/shared/readers";
import { reportKeyingVerificationErrorInCauseChain } from "../../data/keyingProjectionVerification/error";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import { loadDocumentPurgeCheckpoint } from "../../data/persistence/documentPurgeCheckpointPersistence";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import type {
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  ContainerDocumentTombstoneVerifier,
} from "./documentDiscoveryTypes";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

/**
 * The document's verified head link set, or `null` when no verified head is
 * available: the projection could not be fetched (the requester may no
 * longer read the document, or it was purged) or failed verification.
 */
export type DocumentHeadLinkSetLoader = (
  documentId: string,
) => Promise<ReadonlyArray<string> | null>;

export interface DocumentHeadLinkSetLoaderDeps {
  readonly assertDocumentWriterProjectionConsistent: typeof assertDocumentWriterProjectionConsistent;
  readonly loadDocumentPurgeCheckpoint: typeof loadDocumentPurgeCheckpoint;
}

const HEAD_LINK_SET_LOAD_CONCURRENCY = 4;

async function verifiedHeadLinkSet(
  runtime: ContainerContentsWorkflowRuntime,
  deps: DocumentHeadLinkSetLoaderDeps,
  documentId: string,
  projection: DocumentWriterProjectionResponse,
): Promise<ReadonlyArray<string>> {
  const linkedContainerIds: { value?: ReadonlyArray<string> } = {};
  await deps.assertDocumentWriterProjectionConsistent(projection, {
    // Only the link set is read; a bundle wrapped to superseded KEK targets
    // still carries the signed head.
    allowStaleContentKeyBundle: true,
    execSql: runtime.infra.execSql,
    onVerifiedAuthorization: (authorization) => {
      const head = authorization.documentManifestByHash.get(
        projection.documentManifest.manifestHash,
      );
      if (head && head.state.documentId === documentId) {
        linkedContainerIds.value = uniqueSortedStrings(
          head.state.linkedContainerIds,
        );
      }
    },
    resolveProjectionUserKey: createProjectionUserKeyResolver(runtime),
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
  });
  if (!linkedContainerIds.value) {
    throw new Error("Tombstone evidence lacks a verified document head");
  }
  return linkedContainerIds.value;
}

export function createDocumentHeadLinkSetLoader(
  runtime: ContainerContentsWorkflowRuntime,
  deps: DocumentHeadLinkSetLoaderDeps = {
    assertDocumentWriterProjectionConsistent,
    loadDocumentPurgeCheckpoint,
  },
): DocumentHeadLinkSetLoader {
  return async (documentId) => {
    // A verified purge proof is terminal signed evidence that the document
    // links nothing any more.
    if (
      await deps.loadDocumentPurgeCheckpoint(runtime.infra.execSql, documentId)
    ) {
      return [];
    }
    // The cached projection may predate the unlink the tombstone reports.
    runtime.apiClient.evictDocumentWriterProjection(documentId);
    const result = await runtime.apiClient.getDocumentWriterProjectionResult(
      documentId,
      { reportErrors: false },
    );
    if (!result.ok) {
      runtime.util.log(
        `Container contents: tombstone evidence for document ${documentId} is unavailable (${result.status ?? "offline"})`,
      );
      return null;
    }
    try {
      return await verifiedHeadLinkSet(runtime, deps, documentId, result.data);
    } catch (error) {
      await reportKeyingVerificationErrorInCauseChain(
        error,
        runtime.util.reportSecurityIncident,
        {
          objectId: documentId,
          objectKind: "document",
          operation: "document.tombstone-evidence",
        },
      );
      runtime.util.logError?.(
        "Container contents: tombstone evidence verification failed",
        error,
      );
      return null;
    }
  };
}

function judgeTombstones(
  tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  linkedContainerIds: ReadonlyArray<string> | null,
): ContainerDocumentTombstoneVerdict[] {
  return tombstones.map((tombstone) => {
    if (linkedContainerIds === null) {
      return { kind: "unverified", tombstone };
    }
    if (linkedContainerIds.includes(tombstone.containerId)) {
      return { kind: "refuted", tombstone };
    }
    return {
      kind: "verified",
      tombstone: { ...tombstone, linkedContainerIds },
    };
  });
}

/**
 * Judge listing tombstones against each document's verified head link set,
 * fetched once per document with bounded concurrency.
 */
export function createContainerDocumentTombstoneVerifier(
  loadDocumentHeadLinkSet: DocumentHeadLinkSetLoader,
): ContainerDocumentTombstoneVerifier {
  return async (tombstones) => {
    const byDocumentId = new Map<string, ContainerDocumentTombstone[]>();
    for (const tombstone of tombstones) {
      const group = byDocumentId.get(tombstone.documentId) ?? [];
      group.push(tombstone);
      byDocumentId.set(tombstone.documentId, group);
    }
    const groups = [...byDocumentId.entries()];
    const verdicts: ContainerDocumentTombstoneVerdict[][] = [];
    let next = 0;
    const worker = async () => {
      while (next < groups.length) {
        const index = next++;
        const entry = groups[index];
        if (!entry) break;
        const [documentId, group] = entry;
        verdicts[index] = judgeTombstones(
          group,
          await loadDocumentHeadLinkSet(documentId),
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(HEAD_LINK_SET_LOAD_CONCURRENCY, groups.length) },
        worker,
      ),
    );
    return verdicts.flat();
  };
}
