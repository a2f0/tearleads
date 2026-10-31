import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type DocumentSyncResponse,
  documentKekTargetsFromContentKeyBundle,
} from "@tearleads/validators/response";
import {
  getDocumentContentKeyBundle,
  type StoredDocumentContentKeyBundle,
} from "../../../access/read/documentContentKeyStore";
import type { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  readCommitLsnMode,
  readCurrentCommitLsn,
} from "../../../documents/commitLsn";
import {
  assertMinLsnSatisfied,
  readDocumentUpdateUpperBound,
  resolveDocumentUpdateCursorBounds,
} from "../../../documents/documentUpdateStore";
import type { AppliedContainerRekey } from "../../containers/mutations";
import { loadSignerPublicKey } from "../../signerPublicKey";
import type { appendDocumentUpdates } from "./appendOutgoingUpdates";
import { DocumentMutationError, toMutationError } from "./errors";
import { assertProvisionedDocumentInitialUpdate } from "./shared/provisionedInitialUpdate";
import {
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
} from "./shared/records";
import { resolveSyncPullPagePlan } from "./syncPullPagination";
import {
  buildPaginatedSyncPullResponse,
  listMissingSyncUpdatesForResponse,
} from "./syncPullResponse";
import {
  type CreateSeedContext,
  commitSyncDocumentWrites,
  type SyncDocumentWriteInput,
  touchAcceptedSyncTargets,
} from "./syncWriteCommit";
import type { SyncDocumentInput } from "./types";

async function syncDocumentTransaction(
  input: SyncDocumentWriteInput & { readonly cursorHmacKey: string },
) {
  const committed = await commitSyncDocumentWrites(input);
  const result = await buildSyncDocumentTransactionResult({
    ...committed,
    cursorHmacKey: input.cursorHmacKey,
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
  // Touch the linked containers last, so their rows stay locked only from
  // here to commit rather than through the pull page.
  await touchAcceptedSyncTargets({
    currentTargets: committed.currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    insertedUpdateIds: committed.appendResult.insertedUpdateIds,
  });
  return { ...result, containerRekeys: committed.containerRekeys };
}

async function buildSyncDocumentTransactionResult(input: {
  readonly appendResult: Awaited<ReturnType<typeof appendDocumentUpdates>>;
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  readonly cursorHmacKey: string | null;
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
    cursorHmacKey: input.cursorHmacKey,
    identity: pullIdentity,
    request: input.request,
    resolveCursorBounds: (cursor) =>
      resolveDocumentUpdateCursorBounds(input.executor, {
        ...cursor,
        documentId: input.documentId,
      }),
    upperBound,
  });
  const { entries, page } = await listMissingSyncUpdatesForResponse({
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
  if (pullPagePlan === null || page === undefined) {
    throw new DocumentMutationError(
      "Paginated document pull support is required",
      400,
    );
  }
  const responseWithoutCommit = await buildPaginatedSyncPullResponse({
    base: responseBase,
    cursorHmacKey: input.cursorHmacKey,
    entries,
    historyMode: input.request.historyMode,
    identity: pullIdentity,
    loadContentKeyBundle: (contentKeyEpoch) =>
      getDocumentContentKeyBundle(
        input.documentId,
        contentKeyEpoch,
        input.executor,
      ),
    page,
    plan: pullPagePlan,
  });
  return {
    insertedUpdateIds: [...input.appendResult.insertedUpdateIds],
    responseWithoutCommit,
  };
}

export interface DocumentSyncWorkflowResult {
  readonly containerRekeys: readonly AppliedContainerRekey[];
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

interface DocumentCreateSeedInput {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentSyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}

export interface DocumentCreateSeedResult {
  readonly acceptedOutgoingUpdateIds: readonly string[];
  /** Empty when the seed was already committed (a retried create). */
  readonly insertedUpdateIds: readonly string[];
}

/**
 * The seed's response keeps only its accepted ids, so it skips the pull page
 * and keeps the page's request checks: the minimum commit position, the
 * pagination requirement, and the pull cursor, which never authenticates
 * without a signing key.
 */
async function assertCreateSeedPullRequest(input: {
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<void> {
  if (input.request.supportsPullPagination === true) {
    await assertMinLsnSatisfied(input.executor, input.request.minLsn);
  }
  const plan = await resolveSyncPullPagePlan({
    cursorHmacKey: null,
    identity: {
      contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
      documentId: input.documentId,
      linkSetManifestHash: input.contentKeyBundle.linkSetManifestHash,
      targetHash: input.contentKeyBundle.targetHash,
    },
    request: input.request,
    resolveCursorBounds: () =>
      Promise.reject(new Error("A create seed's pull cursor never verifies")),
    upperBound: null,
  });
  if (plan === null) {
    throw new DocumentMutationError(
      "Paginated document pull support is required",
      400,
    );
  }
}

async function commitDocumentCreateSeed(
  input: DocumentCreateSeedInput & {
    readonly enforceSyncEligibility: boolean;
    readonly seed: CreateSeedContext;
  },
): Promise<DocumentCreateSeedResult> {
  assertProvisionedDocumentInitialUpdate(input.request);

  try {
    const committed = await commitSyncDocumentWrites({
      ...input,
      tx: input.executor,
    });
    await assertCreateSeedPullRequest({
      contentKeyBundle: committed.contentKeyBundle,
      documentId: input.documentId,
      executor: input.executor,
      request: input.request,
    });
    await touchAcceptedSyncTargets({
      currentTargets: committed.currentTargets,
      documentId: input.documentId,
      executor: input.executor,
      insertedUpdateIds: committed.appendResult.insertedUpdateIds,
    });
    return {
      acceptedOutgoingUpdateIds:
        committed.appendResult.acceptedOutgoingUpdateIds,
      insertedUpdateIds: [...committed.appendResult.insertedUpdateIds],
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

/**
 * Commits the one encrypted update born with a provisioned document.
 * This stays out of the document-mutations facade: bypassing billing is valid
 * only for the freshly-created artifact in an organization-provisioning
 * transaction.
 */
export async function appendProvisionedDocumentInitialUpdate(
  input: DocumentCreateSeedInput,
): Promise<void> {
  await commitDocumentCreateSeed({
    ...input,
    enforceSyncEligibility: false,
    seed: { syncEligibleOrganizationId: null },
  });
}

/**
 * Commits an ordinary create's seed in the create transaction. It is held to
 * the same sync eligibility and write checks as the standalone sync it
 * replaces, so a seed the sync would refuse fails the create instead.
 * `syncEligibleOrganizationId` is the organization the create already
 * admitted with `assertOrganizationCanSync` in this transaction.
 */
export function appendDocumentCreateSeed(
  input: DocumentCreateSeedInput & {
    readonly syncEligibleOrganizationId: string;
  },
): Promise<DocumentCreateSeedResult> {
  return commitDocumentCreateSeed({
    ...input,
    enforceSyncEligibility: true,
    seed: { syncEligibleOrganizationId: input.syncEligibleOrganizationId },
  });
}

export async function runDocumentSyncWorkflow(
  db: ApiDatabase,
  input: SyncDocumentInput,
  cursorHmacKey: string,
): Promise<DocumentSyncWorkflowResult> {
  try {
    // Read the signer key inside the transaction (parity with the link-set
    // path) so a concurrent key rotation/revocation cannot be bypassed for
    // the in-flight window.
    const transactionResult = await db.transaction(async (tx) =>
      syncDocumentTransaction({
        cursorHmacKey,
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
    const commitLsnMode = readCommitLsnMode();
    const commitLsn = await readCurrentCommitLsn(db);
    const response: DocumentSyncResponse = {
      ...transactionResult.responseWithoutCommit,
      commitLsn,
      commitLsnMode,
    };
    return {
      containerRekeys: transactionResult.containerRekeys,
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
