import type {
  ApiDatabase,
  DatabaseSession,
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
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  readCommitLsnMode,
  readCurrentCommitLsn,
} from "../../../documents/commitLsn";
import { documentAuditAccessFromManifest } from "../../../documents/documentAuditAccess";
import { selectServedSyncUpdateEntries } from "../../../documents/documentSyncBaselineRedirect";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { appendDocumentUpdates } from "./appendOutgoingUpdates";
import { DocumentMutationError, toMutationError } from "./errors";
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
import { listMissingSyncUpdateEntries } from "./syncResponseUpdates";
import { assertSyncRotationBaselinesSound } from "./syncRotationAdvance";
import { lockSyncDocumentWriteFrontier } from "./syncWriteFrontier";
import type {
  DocumentWriteAuthorizationProof,
  SyncDocumentInput,
} from "./types";

function uniqueContentKeyEpochs(contentKeyEpochs: Iterable<number>): number[] {
  return [...new Set(contentKeyEpochs)].sort((left, right) => left - right);
}

async function listContentKeyBundlesForSyncResponse(input: {
  readonly contentKeyEpochs: Iterable<number>;
  readonly currentBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseSession;
}): Promise<StoredDocumentContentKeyBundle[]> {
  const bundleByEpoch = new Map<number, StoredDocumentContentKeyBundle>([
    [input.currentBundle.contentKeyEpoch, input.currentBundle],
  ]);

  for (const contentKeyEpoch of uniqueContentKeyEpochs(
    input.contentKeyEpochs,
  )) {
    if (bundleByEpoch.has(contentKeyEpoch)) {
      continue;
    }

    const bundle = await getDocumentContentKeyBundle(
      input.documentId,
      contentKeyEpoch,
      input.executor,
    );
    if (!bundle) {
      throw new DocumentMutationError(
        "Document content-key bundle missing",
        409,
      );
    }
    bundleByEpoch.set(contentKeyEpoch, bundle);
  }

  return [...bundleByEpoch.values()].sort(
    (left, right) => left.contentKeyEpoch - right.contentKeyEpoch,
  );
}

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

async function listMissingSyncUpdatesWithBundles(input: {
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly request: DocumentSyncRequest;
}) {
  const missingUpdateEntries = await listMissingSyncUpdateEntries({
    documentId: input.documentId,
    executor: input.executor,
    localVersionVector: input.request.localVersionVector,
    minLsn: input.request.minLsn,
  });
  // Redirect readers who are behind a content-key rotation to the current-epoch
  // baseline instead of shipping pre-rotation updates they cannot decrypt (which
  // would poison their all-or-nothing client decrypt). Safe: only drops older
  // updates a readable baseline provably covers, else serves everything.
  const servedUpdateEntries = await selectServedSyncUpdateEntries({
    currentContentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId: input.documentId,
    entries: missingUpdateEntries,
    executor: input.executor,
  });
  const contentKeyBundles = await listContentKeyBundlesForSyncResponse({
    contentKeyEpochs: servedUpdateEntries.map(
      (entry) => entry.writeHeader.contentKeyEpoch,
    ),
    currentBundle: input.contentKeyBundle,
    documentId: input.documentId,
    executor: input.executor,
  });

  return {
    contentKeyBundles,
    missingUpdates: servedUpdateEntries.map((entry) => entry.update),
  };
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
  if (hasOutgoingUpdates) {
    // Serialize accepted content against concurrent container.rekey writes so a
    // stale target set cannot land under a superseded container key epoch.
    // Empty read-only syncs write no content and take no lock.
    currentTargets = await lockSyncDocumentWriteFrontier({
      authorizingContainerIds: syncAuthorizingContainerIds(input.request),
      currentTargets,
      documentId: input.documentId,
      tx: input.tx,
    });
  }
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
  const { contentKeyBundles, missingUpdates } =
    await listMissingSyncUpdatesWithBundles({
      contentKeyBundle: input.contentKeyBundle,
      documentId: input.documentId,
      executor: input.executor,
      request: input.request,
    });

  return {
    accessEpoch: input.currentTargets.linkSetEpoch,
    acceptedOutgoingUpdateIds: input.appendResult.acceptedOutgoingUpdateIds,
    contentKeyBundle: input.contentKeyBundle,
    contentKeyBundles,
    currentTargets: input.currentTargets,
    insertedUpdateIds: [...input.appendResult.insertedUpdateIds],
    missingUpdates,
    servedStaleBundle: input.servedStaleBundle,
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
    const contentKeyBundle = toContentKeyBundleResponse(
      transactionResult.contentKeyBundle,
    );
    return {
      insertedUpdateIds: transactionResult.insertedUpdateIds,
      response: {
        acceptedOutgoingUpdateIds: transactionResult.acceptedOutgoingUpdateIds,
        commitLsn: await readCurrentCommitLsn(db, undefined, {
          clientSupportsUntracked:
            input.request.supportsUntrackedCommitLsn === true,
          minimumLsn: input.request.minLsn,
        }),
        commitLsnMode: readCommitLsnMode(),
        contentKeyBundle,
        contentKeyBundles: transactionResult.contentKeyBundles.map((bundle) =>
          toContentKeyBundleResponse(bundle),
        ),
        documentId: input.documentId,
        // A stale-served read-only pull must echo the targets the bundle
        // actually wraps to; mixing the stale bundle with current targets
        // would fail the client's plan/response consistency checks.
        documentKekTargets: transactionResult.servedStaleBundle
          ? documentKekTargetsFromContentKeyBundle(contentKeyBundle)
          : toDocumentKekTargetsResponse(transactionResult.currentTargets),
        updates: transactionResult.missingUpdates,
      },
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
