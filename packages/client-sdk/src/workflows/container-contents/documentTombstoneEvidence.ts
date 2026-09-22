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

export interface VerifiedDocumentHeadLinkSet {
  readonly accessEpoch: number;
  readonly linkedContainerIds: ReadonlyArray<string>;
}

/**
 * The document's verified head link set, or `null` when no verified head is
 * available: the projection could not be fetched (the requester may no
 * longer read the document, or it was purged) or failed verification.
 */
export type DocumentHeadLinkSetLoader = (
  documentId: string,
) => Promise<VerifiedDocumentHeadLinkSet | null>;

/** The highest access epoch local state records for the document. */
export type LocalDocumentAccessEpochLoader = (
  documentId: string,
) => Promise<number>;

export interface DocumentHeadLinkSetLoaderDeps {
  readonly assertDocumentWriterProjectionConsistent: typeof assertDocumentWriterProjectionConsistent;
  readonly loadDocumentPurgeCheckpoint: typeof loadDocumentPurgeCheckpoint;
}

const HEAD_LINK_SET_LOAD_CONCURRENCY = 4;
/**
 * Head loads per settle. Tombstones beyond it stay unverified and are held
 * for a later, backed-off retry, so a bulk move out of a folder does not cost
 * every device an unbounded burst of fetches before the watermark advances.
 */
const HEAD_LINK_SET_LOADS_PER_RUN = 32;

async function verifiedHeadLinkSet(
  runtime: ContainerContentsWorkflowRuntime,
  deps: DocumentHeadLinkSetLoaderDeps,
  documentId: string,
  projection: DocumentWriterProjectionResponse,
): Promise<VerifiedDocumentHeadLinkSet> {
  const verified: { value?: VerifiedDocumentHeadLinkSet } = {};
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
        verified.value = {
          accessEpoch: head.state.epoch,
          linkedContainerIds: uniqueSortedStrings(
            head.state.linkedContainerIds,
          ),
        };
      }
    },
    resolveProjectionUserKey: createProjectionUserKeyResolver(runtime),
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
  });
  if (!verified.value) {
    throw new Error("Tombstone evidence lacks a verified document head");
  }
  return verified.value;
}

export function createDocumentHeadLinkSetLoader(
  runtime: ContainerContentsWorkflowRuntime,
  deps: DocumentHeadLinkSetLoaderDeps = {
    assertDocumentWriterProjectionConsistent,
    loadDocumentPurgeCheckpoint,
  },
): DocumentHeadLinkSetLoader {
  return async (documentId) => {
    try {
      // A verified purge proof is terminal signed evidence that the document
      // links nothing any more.
      if (
        await deps.loadDocumentPurgeCheckpoint(
          runtime.infra.execSql,
          documentId,
        )
      ) {
        return { accessEpoch: Number.MAX_SAFE_INTEGER, linkedContainerIds: [] };
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
      return await verifiedHeadLinkSet(runtime, deps, documentId, result.data);
    } catch (error) {
      // Any failure leaves the tombstone unverified (held and retried); a
      // thrown error here must not fail the whole discovery pass.
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
        "Container contents: tombstone evidence is unavailable",
        error,
      );
      return null;
    }
  };
}

function judgeTombstones(
  tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  head: VerifiedDocumentHeadLinkSet | null,
): ContainerDocumentTombstoneVerdict[] {
  return tombstones.map((tombstone): ContainerDocumentTombstoneVerdict => {
    if (head === null) {
      return { kind: "unverified", tombstone };
    }
    if (head.linkedContainerIds.includes(tombstone.containerId)) {
      return { kind: "refuted", tombstone };
    }
    return { kind: "verified", tombstone: { ...tombstone, ...head } };
  });
}

/**
 * Judge listing tombstones against each document's verified head link set,
 * fetched once per document with bounded concurrency and a per-run cap. A
 * head whose epoch is below local document state is no evidence: it may be a
 * lagging replica or a replay, and applying it could delete rows a newer
 * listing or settled move wrote.
 */
export function createContainerDocumentTombstoneVerifier(
  loadDocumentHeadLinkSet: DocumentHeadLinkSetLoader,
  loadLocalDocumentAccessEpoch: LocalDocumentAccessEpochLoader,
): ContainerDocumentTombstoneVerifier {
  return async (tombstones) => {
    const byDocumentId = new Map<string, ContainerDocumentTombstone[]>();
    for (const tombstone of tombstones) {
      const group = byDocumentId.get(tombstone.documentId) ?? [];
      group.push(tombstone);
      byDocumentId.set(tombstone.documentId, group);
    }
    const groups = [...byDocumentId.entries()];
    const verdicts: ContainerDocumentTombstoneVerdict[][] = groups.map(
      ([, group]): ContainerDocumentTombstoneVerdict[] =>
        judgeTombstones(group, null),
    );
    let next = 0;
    const worker = async () => {
      while (next < Math.min(groups.length, HEAD_LINK_SET_LOADS_PER_RUN)) {
        const index = next++;
        const entry = groups[index];
        if (!entry) break;
        const [documentId, group] = entry;
        const head = await loadDocumentHeadLinkSet(documentId);
        if (
          head === null ||
          head.accessEpoch < (await loadLocalDocumentAccessEpoch(documentId))
        ) {
          continue;
        }
        verdicts[index] = judgeTombstones(group, head);
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
