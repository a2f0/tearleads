import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import type {
  DocumentCreateResponse,
  DocumentCreateSeedResponse,
} from "@tearleads/validators/response";
import { lockAccessManifestHeadsForShare } from "../../../access/read/accessManifestStore";
import { storeVerifiedAccessManifestInTransaction } from "../../../access/write/accessManifestStore";
import { storeDocumentContentKeyBundleInTransaction } from "../../../access/write/documentContentKeyStore";
import { recordDocumentManifestObservationInTransaction } from "../../../access/write/documentManifestObservationStore";
import {
  readCommitLsnMode,
  readCurrentCommitLsn,
} from "../../../documents/commitLsn";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import { assertRosterProfileDocumentIdCanBeCreated } from "../../organizations/rosterProfileBindingInvariant";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { markStoredDocumentManifest } from "../markStoredDocumentManifest";
import { lockDocumentLifecycleInTransaction } from "./documentLifecycleLock";
import { DocumentMutationError, toMutationError } from "./errors";
import { uniqueSortedContainerIds } from "./linkSetMutationLocks";
import {
  assertCreateCanAdvanceDocumentHead,
  insertDocumentRow,
  touchContainers,
} from "./shared/documentRows";
import {
  documentManifestBundleRecord,
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
  toStoredContentKeyBundleInput,
} from "./shared/records";
import {
  verifyDocumentEvent,
  verifyDocumentManifestFromRequest,
} from "./shared/verification";
import {
  appendDocumentCreateSeed,
  type DocumentCreateSeedResult,
} from "./syncDocument";
import type { CreateDocumentInput } from "./types";

export interface DocumentCreateWorkflowResult {
  /** Seed update ids this create inserted, for the update broadcast. */
  readonly insertedUpdateIds: readonly string[];
  readonly response: DocumentCreateResponse;
}

/**
 * Commits a create's seed in its transaction; see `appendDocumentCreateSeed`.
 * The caller has admitted `syncEligibleOrganizationId` with
 * `assertOrganizationCanSync` in this transaction.
 */
export async function commitDocumentCreateSeedInTransaction(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly seed: DocumentCreateRequest["initialSync"];
  readonly syncEligibleOrganizationId: string;
  readonly userId: string;
}): Promise<DocumentCreateSeedResult | null> {
  if (!input.seed) return null;
  return appendDocumentCreateSeed({
    documentId: input.documentId,
    executor: input.executor,
    fingerprint: input.fingerprint,
    request: input.seed,
    signingPublicKey: await loadSignerPublicKey(input.executor, {
      error: (message, status) => new DocumentMutationError(message, status),
      fingerprint: input.fingerprint,
      userId: input.userId,
    }),
    syncEligibleOrganizationId: input.syncEligibleOrganizationId,
    userId: input.userId,
  });
}

/** Read after commit, as a sync response reports its commit position. */
export async function documentCreateSeedResponse(
  db: ApiDatabase,
  seed: DocumentCreateSeedResult,
): Promise<DocumentCreateSeedResponse> {
  const commitLsnMode = readCommitLsnMode();
  return {
    acceptedOutgoingUpdateIds: [...seed.acceptedOutgoingUpdateIds],
    commitLsn: await readCurrentCommitLsn(db),
    commitLsnMode,
  };
}

export async function runCreateDocumentWorkflow(
  db: ApiDatabase,
  input: CreateDocumentInput,
): Promise<DocumentCreateWorkflowResult> {
  try {
    const { created, seed } = await db.transaction(async (tx) => {
      const { created, linkedContainerIds, organizationId } =
        await createDocumentInTransaction({
          executor: tx,
          fingerprint: input.fingerprint,
          request: input.request,
          userId: input.userId,
        });
      // Public boundary: registration bootstraps its documents via
      // createDocumentWithExecutor directly, so gate only here.
      await assertOrganizationCanSync(tx, organizationId, input.userId);
      const seed = await commitDocumentCreateSeedInTransaction({
        documentId: created.id,
        executor: tx,
        fingerprint: input.fingerprint,
        seed: input.request.initialSync,
        syncEligibleOrganizationId: organizationId,
        userId: input.userId,
      });
      // Touch the linked containers just before commit; a seed that inserted
      // its update already touched them, last.
      if ((seed?.insertedUpdateIds.length ?? 0) === 0) {
        await touchContainers(tx, linkedContainerIds);
      }
      return { created, seed };
    });
    if (!seed) return { insertedUpdateIds: [], response: created };
    return {
      insertedUpdateIds: seed.insertedUpdateIds,
      response: {
        ...created,
        initialSync: await documentCreateSeedResponse(db, seed),
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

async function lockCreateContainerPath(
  executor: DatabaseTransaction,
  request: DocumentCreateRequest,
): Promise<void> {
  // Freeze the authorizing path through commit. Deletion takes the same
  // container heads exclusively before checking emptiness and deleting rows.
  await lockAccessManifestHeadsForShare(
    "container",
    uniqueSortedContainerIds([
      ...(request.targetContainerPathRefs ?? []).map((ref) => ref.containerId),
      ...(request.authorizingContainerPathRefs ?? []).flatMap((path) =>
        path.map((ref) => ref.containerId),
      ),
    ]),
    executor,
  );
}

interface CreateDocumentWithExecutorInput {
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentCreateRequest;
  readonly userId: string;
}

export async function createDocumentWithExecutor(
  input: CreateDocumentWithExecutorInput,
): Promise<DocumentCreateResponse> {
  const { created, linkedContainerIds } =
    await createDocumentInTransaction(input);
  await touchContainers(input.executor, linkedContainerIds);
  return created;
}

// The content-key bundle store resolves the document's current KEK targets
// in this transaction; nothing after it changes heads, links, or epochs, so
// its organization is the one a fresh resolution would return. The caller
// touches the linked containers, as late as it can.
async function createDocumentInTransaction(
  input: CreateDocumentWithExecutorInput,
): Promise<{
  readonly created: DocumentCreateResponse;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
}> {
  try {
    const event = await verifyDocumentEvent({
      body: input.request.body,
      event: input.request.event,
      expectedEventType: "document.link",
      executor: input.executor,
      fingerprint: input.fingerprint,
      userId: input.userId,
    });
    // Optional rekeys are key maintenance, not document authorization. Apply
    // them before path/target validation so this write may reference the new
    // container head that it just committed in the same transaction.
    await applyContainerRekeys({
      executor: input.executor,
      fingerprint: input.fingerprint,
      requests: input.request.containerRekeys,
      userId: input.userId,
    });
    await lockCreateContainerPath(input.executor, input.request);
    const manifest = await verifyDocumentManifestFromRequest({
      event,
      executor: input.executor,
      request: input.request,
    });

    if (
      manifest.state.epoch !== 1 ||
      manifest.state.previousManifestHash !== null
    ) {
      throw new DocumentMutationError(
        "Document create requires an initial link-set manifest",
        400,
      );
    }

    // This lock remains addressable after purge deletes the document and head.
    // Take it before both terminal-state checks so create cannot observe a
    // half-completed purge and then resurrect its retained initial manifest.
    await lockDocumentLifecycleInTransaction(
      input.executor,
      manifest.state.documentId,
    );
    await assertRosterProfileDocumentIdCanBeCreated({
      documentId: manifest.state.documentId,
      executor: input.executor,
    });
    await assertCreateCanAdvanceDocumentHead(
      input.executor,
      manifest.state.documentId,
      manifest.state.linkedContainerIds,
    );
    const document = await insertDocumentRow({
      createdByFingerprint: input.fingerprint,
      executor: input.executor,
      manifest,
    });
    await storeVerifiedAccessManifestInTransaction(
      { verifiedManifest: manifest },
      input.executor,
    );
    await markStoredDocumentManifest(input.executor, manifest.manifestHash);
    await recordDocumentManifestObservationInTransaction(input.executor, {
      documentId: manifest.state.documentId,
      manifestHash: manifest.manifestHash,
      userId: input.userId,
    });
    const contentKeyBundle = await storeDocumentContentKeyBundleInTransaction(
      toStoredContentKeyBundleInput(
        manifest.state.documentId,
        input.request.contentKeyBundle,
      ),
      input.executor,
    );

    return {
      created: {
        id: document.id,
        createdAt: document.createdAt.toISOString(),
        accessManifest: documentManifestBundleRecord(manifest),
        contentKeyBundle: toContentKeyBundleResponse(contentKeyBundle),
        documentKekTargets: toDocumentKekTargetsResponse(
          contentKeyBundle.currentTargets,
        ),
      },
      linkedContainerIds: manifest.state.linkedContainerIds,
      organizationId: contentKeyBundle.currentTargets.organizationId,
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
