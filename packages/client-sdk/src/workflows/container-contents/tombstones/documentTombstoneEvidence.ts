import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  type DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  assertDocumentCreateSigner,
  assertDocumentWriterProjectionConsistent,
} from "../../../data/documents/shared/projection";
import { uniqueSortedStrings } from "../../../data/documents/shared/readers";
import { checkWithHeldBundleRecovery } from "../../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification/userKeyResolver";
import type { DocumentPurgeCheckpoint } from "../../../data/persistence/keyingCheckpoints/documentPurgeCheckpointPersistence";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import { reportKeyingVerificationErrorInCauseChain } from "../../../data/shared/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { PrincipalPolicyOperation } from "../../principals/principalPolicyService";
import type {
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  ContainerDocumentTombstoneVerifier,
} from "../documentDiscovery/documentDiscoveryTypes";
import { documentHeadMatchesOrganization } from "../documentDiscovery/documentHeadScope";
import type {
  ContainerContentsStoreWorkflowRuntime,
  ContainerContentsWorkflowRuntime,
} from "../runtime";

export interface VerifiedDocumentHeadLinkSet {
  readonly organizationId: string | null;
  readonly accessEpoch: number;
  /** Present for a signed head; a terminal purge has no live access state. */
  readonly accessStateHash?: string;
  readonly linkedContainerIds: ReadonlyArray<string>;
}

/**
 * The document's verified head link set, or `null` when no verified head is
 * available: the projection could not be fetched (the requester may no
 * longer read the document, or it was purged) or failed verification.
 */
export type DocumentHeadLinkSetLoader = (
  documentId: string,
  expectedManifestHash?: string,
  expectedSignerUserId?: string,
) => Promise<VerifiedDocumentHeadLinkSet | "not-found" | null>;

/** The highest access epoch local state records for the document. */
export type LocalDocumentAccessEpochLoader = (
  documentId: string,
) => Promise<number>;

export interface DocumentHeadLinkSetLoaderDeps {
  readonly assertDocumentWriterProjectionConsistent: typeof assertDocumentWriterProjectionConsistent;
  readonly loadDocumentPurgeCheckpoint: (
    execSql: ExecSql,
    documentId: string,
  ) => Promise<DocumentPurgeCheckpoint | null>;
}

export const HEAD_LINK_SET_LOAD_CONCURRENCY = 4;
/**
 * Head loads per settle. Tombstones beyond it stay unverified and are held
 * for a later, backed-off retry, so a bulk move out of a folder does not cost
 * every device an unbounded burst of fetches before the watermark advances.
 */
export const HEAD_LINK_SET_LOADS_PER_RUN = 32;

async function verifiedHeadLinkSet(
  runtime: ContainerContentsWorkflowRuntime,
  deps: DocumentHeadLinkSetLoaderDeps,
  documentId: string,
  projection: DocumentWriterProjectionResponse,
  policyOperation: PrincipalPolicyOperation | undefined,
  stillCurrent: () => boolean,
): Promise<VerifiedDocumentHeadLinkSet> {
  const verified: { value?: VerifiedDocumentHeadLinkSet } = {};
  await deps.assertDocumentWriterProjectionConsistent(projection, {
    // Only the link set is read; a bundle wrapped to superseded KEK targets
    // still carries the signed head.
    allowStaleContentKeyBundle: true,
    stillCurrent,
    execSql: runtime.infra.execSql,
    onVerifiedAuthorization: (authorization) => {
      const head = authorization.documentManifestByHash.get(
        projection.documentManifest.manifestHash,
      );
      if (head && head.state.documentId === documentId) {
        verified.value = {
          organizationId: head.state.organizationId,
          accessEpoch: head.state.epoch,
          accessStateHash: head.manifestHash,
          linkedContainerIds: uniqueSortedStrings(
            head.state.linkedContainerIds,
          ),
        };
      }
    },
    resolveProjectionUserKey: createProjectionUserKeyResolver(runtime),
    warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer({
      operation: policyOperation,
    }),
  });
  if (!verified.value) {
    throw new Error("Tombstone evidence lacks a verified document head");
  }
  return verified.value;
}

async function reportUnavailableHead(
  runtime: ContainerContentsWorkflowRuntime,
  documentId: string,
  error: unknown,
): Promise<void> {
  const integrityFailure = await reportKeyingVerificationErrorInCauseChain(
    error,
    runtime.util.reportSecurityIncident,
    {
      objectId: documentId,
      objectKind: "document",
      operation: "document.tombstone-evidence",
    },
  );
  try {
    if (
      !integrityFailure &&
      error instanceof ProjectionDependencyUnavailableError
    ) {
      // A policy can advance without changing this document's hash. Drop its
      // cached evidence so the held head can recover on the next run.
      runtime.apiClient.evictDocumentWriterProjection(documentId);
      runtime.util.log(
        `Container contents: tombstone evidence for document ${documentId} is awaiting current policy history`,
      );
      return;
    }
    runtime.util.logError?.(
      "Container contents: tombstone evidence is unavailable",
      error,
    );
  } catch {
    // A host logger that throws must not fail the discovery pass.
  }
}

/** Only a typed 404 proves absence; any other failure leaves the head unavailable. */
function failedHeadVerdict(
  runtime: ContainerContentsWorkflowRuntime,
  documentId: string,
  failure: {
    readonly code?: string | undefined;
    readonly status?: number | null | undefined;
  },
): "not-found" | null {
  if (failure.status === 404 && failure.code === DOCUMENT_NOT_FOUND_ERROR_CODE)
    return "not-found";
  runtime.util.log(
    `Container contents: tombstone evidence for document ${documentId} is unavailable (${failure.status ?? "offline"})`,
  );
  return null;
}

async function fetchDocumentHead(
  runtime: ContainerContentsWorkflowRuntime,
  documentId: string,
  expectedManifestHash: string | undefined,
  assertCurrent: () => void,
  requestGuard: (() => boolean) | undefined,
  signal?: AbortSignal,
) {
  // Tombstones require a fresh head. Listings can reuse a matching cached
  // projection, whose signature and local checkpoint are still verified.
  if (!expectedManifestHash)
    runtime.apiClient.evictDocumentWriterProjection(documentId);
  const fetchHead = () => {
    const deadline =
      signal && AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    return runtime.apiClient.getDocumentWriterProjectionResult(documentId, {
      reportErrors: false,
      stillCurrent: deadline
        ? () => !deadline.aborted && requestGuard?.() !== false
        : requestGuard,
      signal: deadline,
    });
  };
  let result = await fetchHead();
  assertCurrent();
  if (
    expectedManifestHash &&
    result.ok &&
    result.data.documentManifest.manifestHash !== expectedManifestHash
  ) {
    runtime.apiClient.evictDocumentWriterProjection(documentId);
    result = await fetchHead();
  }
  assertCurrent();
  return result;
}

/** `policyOperation` lets one discovery pass share a directory discovery. */
export function createDocumentHeadLinkSetLoader(
  runtime: ContainerContentsWorkflowRuntime &
    Pick<ContainerContentsStoreWorkflowRuntime, "liveHydrationStatus">,
  deps: DocumentHeadLinkSetLoaderDeps = {
    assertDocumentWriterProjectionConsistent,
    loadDocumentPurgeCheckpoint: (execSql, documentId) =>
      new KeyingCheckpointRepository(execSql).loadDocumentPurgeCheckpoint(
        documentId,
      ),
  },
  policyOperation?: PrincipalPolicyOperation,
  signal?: AbortSignal,
): DocumentHeadLinkSetLoader {
  const stillCurrent = () =>
    !signal?.aborted && runtime.liveHydrationStatus?.() !== "retired";
  function assertCurrent() {
    if (!stillCurrent()) throw new Error("Document head lookup scope changed.");
  }
  return async (documentId, expectedManifestHash, expectedSignerUserId) => {
    try {
      // A verified purge proof is terminal signed evidence that the document
      // links nothing any more.
      assertCurrent();
      const purge = await deps.loadDocumentPurgeCheckpoint(
        runtime.infra.execSql,
        documentId,
      );
      assertCurrent();
      if (purge) {
        return {
          organizationId: null,
          accessEpoch: Number.MAX_SAFE_INTEGER,
          linkedContainerIds: [],
        };
      }
      const result = await fetchDocumentHead(
        runtime,
        documentId,
        expectedManifestHash,
        assertCurrent,
        expectedSignerUserId || signal ? stillCurrent : undefined,
        signal,
      );
      if (!result.ok) return failedHeadVerdict(runtime, documentId, result);
      const projection = result.data;
      if (expectedSignerUserId) {
        await checkWithHeldBundleRecovery(
          { execSql: runtime.infra.execSql, projection, stillCurrent },
          async () =>
            assertDocumentCreateSigner(
              { documentId, expectedSignerUserId },
              projection,
            ),
        );
      }
      assertCurrent();
      const head = await verifiedHeadLinkSet(
        runtime,
        deps,
        documentId,
        result.data,
        policyOperation,
        stillCurrent,
      );
      assertCurrent();
      return head;
    } catch (error) {
      signal?.throwIfAborted();
      // Any failure leaves the tombstone unverified (held and retried); a
      // thrown error here must not fail the whole discovery pass.
      if (stillCurrent())
        await reportUnavailableHead(runtime, documentId, error);
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
      return {
        kind: "refuted",
        linkedContainerIds: head.linkedContainerIds,
        tombstone,
      };
    }
    return {
      kind: "verified",
      tombstone: {
        ...tombstone,
        accessEpoch: head.accessEpoch,
        linkedContainerIds: head.linkedContainerIds,
      },
    };
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
  organizationId: string | undefined,
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
      ([, group], index): ContainerDocumentTombstoneVerdict[] =>
        index < HEAD_LINK_SET_LOADS_PER_RUN
          ? judgeTombstones(group, null)
          : group.map((tombstone) => ({ kind: "deferred", tombstone })),
    );
    // A missing, foreign, or older-than-local head is no evidence.
    const evidentialHead = async (documentId: string) => {
      const head = await loadDocumentHeadLinkSet(documentId);
      if (head === null || head === "not-found") return null;
      if (!documentHeadMatchesOrganization(head, organizationId)) return null;
      // A local-state read that fails is treated like an unavailable head:
      // the tombstones stay held rather than failing the discovery pass.
      const localEpoch = await loadLocalDocumentAccessEpoch(documentId).catch(
        () => Number.MAX_SAFE_INTEGER,
      );
      return head.accessEpoch < localEpoch ? null : head;
    };
    let next = 0;
    const worker = async () => {
      while (next < Math.min(groups.length, HEAD_LINK_SET_LOADS_PER_RUN)) {
        const index = next++;
        const entry = groups[index];
        if (!entry) break;
        const [documentId, group] = entry;
        const head = await evidentialHead(documentId);
        if (head !== null) verdicts[index] = judgeTombstones(group, head);
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
