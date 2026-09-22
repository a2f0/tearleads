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

function verifiedHeadLinkSet(
  runtime: ContainerContentsWorkflowRuntime,
  projection: DocumentWriterProjectionResponse,
): Promise<ReadonlyArray<string>> {
  const linkedContainerIds: { value?: ReadonlyArray<string> } = {};
  return assertDocumentWriterProjectionConsistent(projection, {
    // Only the link set is read; a bundle wrapped to superseded KEK targets
    // still carries the signed head.
    allowStaleContentKeyBundle: true,
    execSql: runtime.infra.execSql,
    onVerifiedAuthorization: (authorization) => {
      const head = authorization.documentManifestByHash.get(
        projection.documentManifest.manifestHash,
      );
      if (head) {
        linkedContainerIds.value = uniqueSortedStrings(
          head.state.linkedContainerIds,
        );
      }
    },
    resolveProjectionUserKey: createProjectionUserKeyResolver(runtime),
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
  }).then(() => {
    if (!linkedContainerIds.value) {
      throw new Error("Tombstone evidence lacks a verified document head");
    }
    return linkedContainerIds.value;
  });
}

export function createDocumentHeadLinkSetLoader(
  runtime: ContainerContentsWorkflowRuntime,
): DocumentHeadLinkSetLoader {
  return async (documentId) => {
    // A verified purge proof is terminal signed evidence that the document
    // links nothing any more.
    if (await loadDocumentPurgeCheckpoint(runtime.infra.execSql, documentId)) {
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
      return await verifiedHeadLinkSet(runtime, result.data);
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
 * fetched once per document.
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
    const verdicts: ContainerDocumentTombstoneVerdict[] = [];
    for (const [documentId, group] of byDocumentId) {
      verdicts.push(
        ...judgeTombstones(group, await loadDocumentHeadLinkSet(documentId)),
      );
    }
    return verdicts;
  };
}
