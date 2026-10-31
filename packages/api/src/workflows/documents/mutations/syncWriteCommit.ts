import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type DocumentKekTargetsRead,
  type DocumentLinkSetFrontier,
  resolveCurrentDocumentKekTargets,
} from "../../../access/read/documentKekTargets";
import { assertDocumentSyncBillingAllowed } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import { appendDocumentUpdates } from "./appendOutgoingUpdates";
import { documentSyncStateStale } from "./errors";
import { uniqueSortedContainerIds } from "./linkSetMutationLocks";
import { touchDocumentAndLinkedContainers } from "./shared/documentRows";
import { verifySyncWriteAuthorizationProof } from "./shared/verification";
import { ensureSyncDocumentAccess } from "./syncAccess";
import { resolveSyncContentKeyBundle } from "./syncContentKeyBundle";
import { assertSyncRotationBaselinesSound } from "./syncRotationAdvance";
import { prepareSyncDocumentTransaction } from "./syncTransactionPreparation";
import {
  type LockedContainerHeads,
  lockSyncDocumentPullWatermark,
  lockSyncDocumentWriteFrontier,
} from "./syncWriteFrontier";
import type { DocumentWriteAuthorizationProof } from "./types";

// Updates are stamped with the epoch of the manifest that authorized the write;
// a read-only pull never inserts, so it falls back to the current link set.
function resolveSyncAccessEpoch(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
}): number {
  return input.writeAuthorization
    ? input.writeAuthorization.documentManifest.state.epoch
    : input.currentTargets.linkSetEpoch;
}

export async function touchAcceptedSyncTargets(input: {
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

/**
 * Lock the sync frontier and resolve the document KEK targets once, after the
 * locks. Writes resolve strictly; a read-only pull tolerates historical parent
 * epochs. The content-key check reuses this read at the same strictness.
 */
async function lockSyncDocumentFrontier(input: {
  readonly documentId: string;
  readonly frontier: DocumentLinkSetFrontier;
  readonly request: DocumentSyncRequest;
  readonly tx: DatabaseTransaction;
}): Promise<{
  readonly lockedContainerHeads?: LockedContainerHeads;
  readonly lockedTargets: DocumentKekTargetsRead;
}> {
  if (input.request.outgoingUpdates.length > 0) {
    const locked = await lockSyncDocumentWriteFrontier({
      authorizingContainerIds: syncAuthorizingContainerIds(input.request),
      documentId: input.documentId,
      frontier: input.frontier,
      tx: input.tx,
    });
    return {
      lockedContainerHeads: locked.lockedContainerHeads,
      lockedTargets: {
        allowHistoricalParentEpochs: false,
        targets: locked.targets,
      },
    };
  }
  if (input.request.supportsPullPagination === true) {
    await lockSyncDocumentPullWatermark({
      documentId: input.documentId,
      tx: input.tx,
    });
  }
  const lockedTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
    true,
  );
  if (
    input.request.supportsPullPagination === true &&
    lockedTargets.linkSetManifestHash !== input.frontier.linkSetManifestHash
  ) {
    throw documentSyncStateStale(
      "Document manifest changed while freezing the pull watermark",
    );
  }
  return {
    lockedTargets: {
      allowHistoricalParentEpochs: true,
      targets: lockedTargets,
    },
  };
}

function documentSyncHasWrites(request: DocumentSyncRequest): boolean {
  return (
    request.outgoingUpdates.length > 0 ||
    (request.containerRekeys?.length ?? 0) > 0
  );
}

export interface SyncDocumentWriteInput {
  readonly documentId: string;
  readonly enforceSyncEligibility: boolean;
  readonly fingerprint: string;
  readonly request: DocumentSyncRequest;
  readonly seed?: CreateSeedContext;
  readonly signingPublicKey: Uint8Array;
  readonly tx: DatabaseTransaction;
  readonly userId: string;
}

/** What a create's seed may reuse from the create in its transaction. */
export interface CreateSeedContext {
  /**
   * The organization this transaction already admitted with
   * `assertOrganizationCanSync`; null when the caller checked none.
   */
  readonly syncEligibleOrganizationId: string | null;
}

async function assertSyncBillingAllowed(
  input: SyncDocumentWriteInput,
  organizationId: string,
): Promise<void> {
  if (!input.enforceSyncEligibility) return;
  // A create already admitted this organization with entitlement and a seat,
  // which covers the seed's write check; any other organization is checked.
  if (input.seed?.syncEligibleOrganizationId === organizationId) return;
  await assertDocumentSyncBillingAllowed(input.tx, {
    organizationId,
    requireWriteEntitlement: documentSyncHasWrites(input.request),
    userId: input.userId,
  });
}

/** Everything a sync commits, up to and including its appended updates. */
export interface CommittedSyncDocumentWrites {
  readonly appendResult: Awaited<ReturnType<typeof appendDocumentUpdates>>;
  readonly containerRekeys: Awaited<ReturnType<typeof applyContainerRekeys>>;
  readonly contentKeyBundle: Awaited<
    ReturnType<typeof resolveSyncContentKeyBundle>
  >["contentKeyBundle"];
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly servedStaleBundle: boolean;
}

export async function commitSyncDocumentWrites(
  input: SyncDocumentWriteInput,
): Promise<CommittedSyncDocumentWrites> {
  const frontier = await prepareSyncDocumentTransaction({
    ...input,
    documentInsertedInTransaction: input.seed !== undefined,
  });
  // Run signed container.rekey payloads before resolving document KEK targets;
  // content-key validation then compares the write against the updated target
  // set, while transaction rollback keeps failed writes from publishing rekeys.
  // Rekeys change container epochs, not the document's links, so the
  // preflight's link ids still plan the locks.
  const containerRekeys = await applyContainerRekeys({
    executor: input.tx,
    fingerprint: input.fingerprint,
    requests: input.request.containerRekeys,
    userId: input.userId,
  });
  // Serialize writes against rekeys and serialize paginated watermark capture
  // against update-sequence allocation, then resolve the targets once.
  const { lockedContainerHeads, lockedTargets } =
    await lockSyncDocumentFrontier({
      documentId: input.documentId,
      frontier,
      request: input.request,
      tx: input.tx,
    });
  const currentTargets = lockedTargets.targets;
  await ensureSyncDocumentAccess({
    containerIds: currentTargets.targets.map((target) => target.containerId),
    executor: input.tx,
    request: input.request,
    userId: input.userId,
  });
  await assertSyncBillingAllowed(input, currentTargets.organizationId);
  const writeAuthorization = await verifySyncWriteAuthorizationProof({
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    ...(lockedContainerHeads ? { lockedContainerHeads } : {}),
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
      lockedTargets,
      request: input.request,
    });
  const appendResult = await appendDocumentUpdates({
    accessEpoch: resolveSyncAccessEpoch({ currentTargets, writeAuthorization }),
    documentId: input.documentId,
    executor: input.tx,
    fingerprint: input.fingerprint,
    organizationId: currentTargets.organizationId,
    request: input.request,
    signingPublicKey: input.signingPublicKey,
    userId: input.userId,
    writeAuthorization,
  });
  return {
    appendResult,
    containerRekeys,
    contentKeyBundle,
    currentTargets,
    servedStaleBundle,
  };
}
