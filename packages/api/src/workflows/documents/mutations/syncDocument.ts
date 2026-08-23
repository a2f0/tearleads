import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  type DocumentSyncResponse,
  documentKekTargetsFromContentKeyBundle,
} from "@symcrypt/validators/response";
import type { StoredDocumentContentKeyBundle } from "../../../access/read/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  readCommitLsnMode,
  readCurrentCommitLsn,
} from "../../../documents/commitLsn";
import { documentAuditAccessFromManifest } from "../../../documents/documentAuditAccess";
import {
  assertMinLsnSatisfied,
  readDocumentUpdateUpperBound,
  resolveDocumentUpdateCursorBounds,
} from "../../../documents/documentUpdateStore";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { appendDocumentUpdates } from "./appendOutgoingUpdates";
import {
  DocumentMutationError,
  documentSyncStateStale,
  toMutationError,
} from "./errors";
import { uniqueSortedContainerIds } from "./linkSetMutationLocks";
import {
  ensureDocumentExists,
  touchDocumentAndLinkedContainers,
} from "./shared/documentRows";
import { assertProvisionedDocumentInitialUpdate } from "./shared/provisionedInitialUpdate";
import {
  assertSyncContentKeyBundleMatchesRequest,
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
} from "./shared/records";
import { verifySyncWriteAuthorizationProof } from "./shared/verification";
import { ensureSyncDocumentAccess } from "./syncAccess";
import { resolveSyncContentKeyBundle } from "./syncContentKeyBundle";
import { resolveSyncPullPagePlan } from "./syncPullPagination";
import {
  buildPaginatedSyncPullResponse,
  listMissingSyncUpdatesWithBundles,
} from "./syncPullResponse";
import { assertSyncRotationBaselinesSound } from "./syncRotationAdvance";
import {
  lockSyncDocumentPullWatermark,
  lockSyncDocumentWriteFrontier,
} from "./syncWriteFrontier";
import type {
  DocumentWriteAuthorizationProof,
  SyncDocumentInput,
} from "./types";

async function resolveSyncAuditAccess(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
}) {
  return input.writeAuthorization
    ? documentAuditAccessFromManifest(input.writeAuthorization.documentManifest)
    : {
        accessEpoch: input.currentTargets.linkSetEpoch,
        accessManifestHash: input.currentTargets.linkSetManifestHash,
        accessStateHash: null,
      };
}

async function touchAcceptedSyncTargets(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly insertedUpdateIds: ReadonlySet<string>;
}) {
  if (input.insertedUpdateIds.size === 0) {
    return;
  }

  await touchDocumentAndLinkedContainers(input.executor, {
    documentId: input.documentId,
    incrementAttributionRevision: true,
    linkedContainerIds: input.currentTargets.targets.map(
      (target) => target.containerId,
    ),
  });
}

// The wire schema deliberately accepts any non-empty container id, so the
// refs are UUID-validated (mirroring the link-set lock plan) before they
// reach the uuid-typed lock query, where a malformed id would surface as an
// uncaught SQLSTATE 22P02 500 instead of a 400.
function syncAuthorizingContainerIds(request: DocumentSyncRequest): string[] {
  return uniqueSortedContainerIds(
    (request.authorizingContainerPathRefs ?? []).flatMap((path) =>
      path.map((ref) => ref.containerId),
    ),
  );
}

async function assertDocumentSyncAllowed(
  input: {
    readonly tx: DatabaseTransaction;
    readonly userId: string;
  },
  organizationId: string,
): Promise<void> {
  await assertOrganizationCanSync(input.tx, organizationId, input.userId);
}

async function lockSyncDocumentFrontier(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly request: DocumentSyncRequest;
  readonly tx: DatabaseTransaction;
}) {
  if (input.request.outgoingUpdates.length > 0) {
    return lockSyncDocumentWriteFrontier({
      authorizingContainerIds: syncAuthorizingContainerIds(input.request),
      currentTargets: input.currentTargets,
      documentId: input.documentId,
      tx: input.tx,
    });
  }
  if (input.request.supportsPullPagination !== true) {
    return input.currentTargets;
  }

  await lockSyncDocumentPullWatermark({
    documentId: input.documentId,
    tx: input.tx,
  });
  const lockedTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  if (
    lockedTargets.linkSetManifestHash !==
    input.currentTargets.linkSetManifestHash
  ) {
    throw documentSyncStateStale(
      "Document manifest changed while freezing the pull watermark",
    );
  }
  return lockedTargets;
}

async function syncDocumentTransaction(input: {
  readonly documentId: string;
  readonly enforceSyncEligibility: boolean;
  readonly fingerprint: string;
  readonly request: DocumentSyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly tx: DatabaseTransaction;
  readonly userId: string;
}) {
  await ensureDocumentExists({
    documentId: input.documentId,
    executor: input.tx,
  });
  assertSyncContentKeyBundleMatchesRequest(input.request);
  // Run signed container.rekey payloads before resolving document KEK targets;
  // content-key validation then compares the write against the updated target
  // set, while transaction rollback keeps failed writes from publishing rekeys.
  await applyContainerRekeys({
    executor: input.tx,
    fingerprint: input.fingerprint,
    requests: input.request.containerRekeys,
    userId: input.userId,
  });
  let currentTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  const hasOutgoingUpdates = input.request.outgoingUpdates.length > 0;
  const hasContainerRekeys = (input.request.containerRekeys?.length ?? 0) > 0;
  // Serialize writes against rekeys and serialize paginated watermark capture
  // against update-sequence allocation.
  currentTargets = await lockSyncDocumentFrontier({
    currentTargets,
    documentId: input.documentId,
    request: input.request,
    tx: input.tx,
  });
  await ensureSyncDocumentAccess({
    currentTargets,
    executor: input.tx,
    request: input.request,
    userId: input.userId,
  });
  if (
    input.enforceSyncEligibility &&
    (hasOutgoingUpdates || hasContainerRekeys)
  ) {
    await assertDocumentSyncAllowed(input, currentTargets.organizationId);
  }
  const writeAuthorization = await verifySyncWriteAuthorizationProof({
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
  // Must run before the bundle store below advances the latest epoch and
  // before the append inserts any baseline row.
  await assertSyncRotationBaselinesSound({
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
  const { contentKeyBundle, servedStaleBundle } =
    await resolveSyncContentKeyBundle({
      documentId: input.documentId,
      executor: input.tx,
      request: input.request,
    });
  const auditAccess = await resolveSyncAuditAccess({
    currentTargets,
    writeAuthorization,
  });
  const appendResult = await appendDocumentUpdates({
    accessEpoch: auditAccess.accessEpoch,
    accessManifestHash: auditAccess.accessManifestHash,
    accessStateHash: auditAccess.accessStateHash,
    documentId: input.documentId,
    executor: input.tx,
    fingerprint: input.fingerprint,
    organizationId: currentTargets.organizationId,
    request: input.request,
    signingPublicKey: input.signingPublicKey,
    userId: input.userId,
    writeAuthorization,
  });
  await touchAcceptedSyncTargets({
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    insertedUpdateIds: appendResult.insertedUpdateIds,
  });

  return buildSyncDocumentTransactionResult({
    appendResult,
    contentKeyBundle,
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
    servedStaleBundle,
  });
}

async function buildSyncDocumentTransactionResult(input: {
  readonly appendResult: Awaited<ReturnType<typeof appendDocumentUpdates>>;
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
  readonly servedStaleBundle: boolean;
}) {
  if (input.request.supportsPullPagination === true) {
    // A replica may advance between statements, which is safe only in this
    // order: first prove it reached the requested commit, then freeze a
    // snapshot bound at that point or later.
    await assertMinLsnSatisfied(input.executor, input.request.minLsn);
  }
  const upperBound =
    input.request.supportsPullPagination === true
      ? await readDocumentUpdateUpperBound(input.executor, input.documentId)
      : null;
  const pullIdentity = {
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId: input.documentId,
    linkSetManifestHash: input.contentKeyBundle.linkSetManifestHash,
    targetHash: input.contentKeyBundle.targetHash,
  };
  const pullPagePlan = await resolveSyncPullPagePlan({
    identity: pullIdentity,
    request: input.request,
    resolveCursorBounds: (cursor) =>
      resolveDocumentUpdateCursorBounds(input.executor, {
        ...cursor,
        documentId: input.documentId,
      }),
    upperBound,
  });
  const { contentKeyBundles, entries, page } =
    await listMissingSyncUpdatesWithBundles({
      contentKeyBundle: input.contentKeyBundle,
      documentId: input.documentId,
      executor: input.executor,
      pullPagePlan,
      request: input.request,
    });
  const contentKeyBundle = toContentKeyBundleResponse(input.contentKeyBundle);
  const responseBase = {
    acceptedOutgoingUpdateIds: input.appendResult.acceptedOutgoingUpdateIds,
    contentKeyBundle,
    documentId: input.documentId,
    // A stale-served read-only pull must echo the targets the bundle actually
    // wraps to; mixing the stale bundle with current targets would fail the
    // client's plan/response consistency checks.
    documentKekTargets: input.servedStaleBundle
      ? documentKekTargetsFromContentKeyBundle(contentKeyBundle)
      : toDocumentKekTargetsResponse(input.currentTargets),
  };
  let responseWithoutCommit: Omit<
    DocumentSyncResponse,
    "commitLsn" | "commitLsnMode"
  >;
  if (pullPagePlan === null) {
    responseWithoutCommit = {
      ...responseBase,
      contentKeyBundles: contentKeyBundles.map((bundle) =>
        toContentKeyBundleResponse(bundle),
      ),
      updates: entries.map(({ update }) => update),
    };
  } else {
    if (page === undefined) {
      throw new Error("Paginated document pull did not return page metadata");
    }
    responseWithoutCommit = buildPaginatedSyncPullResponse({
      base: responseBase,
      contentKeyBundles,
      entries,
      identity: pullIdentity,
      page,
      plan: pullPagePlan,
    });
  }
  return {
    insertedUpdateIds: [...input.appendResult.insertedUpdateIds],
    responseWithoutCommit,
  };
}

export interface DocumentSyncWorkflowResult {
  /**
   * Update ids newly inserted by this sync, excluding idempotent duplicates the
   * client re-sent on retry. The `document_update_created` broadcast is gated on
   * this being non-empty so a retry that only re-acknowledges already-stored
   * updates does not re-ping peers with a redundant pull. The response's
   * `acceptedOutgoingUpdateIds` still reflects every acknowledged outgoing id
   * for the caller's own pending-queue reconciliation.
   */
  readonly insertedUpdateIds: readonly string[];
  readonly response: DocumentSyncResponse;
}

/**
 * Commits the one encrypted update born with a provisioned document.
 * This stays out of the document-mutations facade: bypassing billing is valid
 * only for the freshly-created artifact in an organization-provisioning
 * transaction.
 */
export async function appendProvisionedDocumentInitialUpdate(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentSyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}): Promise<void> {
  assertProvisionedDocumentInitialUpdate(input.request);

  try {
    await syncDocumentTransaction({
      documentId: input.documentId,
      enforceSyncEligibility: false,
      fingerprint: input.fingerprint,
      request: input.request,
      signingPublicKey: input.signingPublicKey,
      tx: input.executor,
      userId: input.userId,
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

export async function runDocumentSyncWorkflow(
  db: ApiDatabase,
  input: SyncDocumentInput,
): Promise<DocumentSyncWorkflowResult> {
  try {
    // Read the signer key inside the transaction (parity with the link-set
    // path) so a concurrent key rotation/revocation cannot be bypassed for
    // the in-flight window.
    const transactionResult = await db.transaction(async (tx) =>
      syncDocumentTransaction({
        documentId: input.documentId,
        enforceSyncEligibility: true,
        fingerprint: input.fingerprint,
        request: input.request,
        signingPublicKey: await loadSignerPublicKey(tx, {
          ...input,
          error: (message, status) =>
            new DocumentMutationError(message, status),
        }),
        tx,
        userId: input.userId,
      }),
    );
    const clientSupportsUntracked =
      input.request.supportsUntrackedCommitLsn === true;
    const commitLsnMode = readCommitLsnMode(undefined, {
      clientSupportsUntracked,
      minimumLsn: input.request.minLsn,
    });
    const commitLsn =
      commitLsnMode === undefined && input.request.minLsn === undefined
        ? null
        : await readCurrentCommitLsn(db, undefined, {
            clientSupportsUntracked,
            minimumLsn: input.request.minLsn,
          });
    const response: DocumentSyncResponse = {
      ...transactionResult.responseWithoutCommit,
      commitLsn,
      ...(commitLsnMode === undefined ? {} : { commitLsnMode }),
    };
    return {
      insertedUpdateIds: transactionResult.insertedUpdateIds,
      response,
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
