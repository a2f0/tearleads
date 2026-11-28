import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { PrincipalPolicyAuthorization } from "@tearleads/crypto";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { getCurrentAccessManifestHeads } from "../../../access/read/accessManifestStore";
import {
  type DocumentKekTargetsRead,
  type DocumentLinkSetFrontier,
  resolveCurrentDocumentKekTargets,
} from "../../../access/read/documentKekTargets";
import { getCurrentPrincipalStates } from "../../../access/read/principalStateStore";
import { assertDocumentSyncBillingAllowed } from "../../billing/organizationSyncEligibility";
import { loadLiveContainerOrganizations } from "../../containers/liveContainerRows";
import { applyContainerRekeys } from "../../containers/mutations";
import { appendDocumentUpdates } from "./appendOutgoingUpdates";
import { documentSyncStateStale } from "./errors";
import { uniqueSortedContainerIds } from "./linkSetMutationLocks";
import {
  type CreatedDocumentSeed,
  takeCreatedDocumentSeed,
} from "./shared/createdDocumentSeed";
import type { LockedContainerHeadRows } from "./shared/currentContainerPaths";
import { touchContainersForDocument } from "./shared/documentRows";
import { verifySyncWriteAuthorizationProof } from "./shared/verification";
import {
  ensureSyncDocumentAccess,
  type VerifiedDocumentAccessResult,
} from "./syncAccess";
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

  // `count_document_updates` already incremented `update_count` and
  // `attribution_revision`, stamped `updated_at`, and enqueued deferred
  // discovery publication on `documents`; only linked containers remain.
  await touchContainersForDocument(input.executor, {
    documentId: input.documentId,
    linkedContainerIds: input.currentTargets.targets.map(
      (target) => target.containerId,
    ),
    organizationId: input.currentTargets.organizationId,
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
  readonly createdTargets?: DocumentKekTargetsRead | undefined;
  readonly documentId: string;
  readonly frontier: DocumentLinkSetFrontier;
  readonly request: DocumentSyncRequest;
  readonly requireHeldHeads: boolean;
  readonly tx: DatabaseTransaction;
}): Promise<{
  readonly lockedContainerHeads?: LockedContainerHeads;
  readonly lockedTargets: DocumentKekTargetsRead;
}> {
  if (input.request.outgoingUpdates.length > 0) {
    const locked = await lockSyncDocumentWriteFrontier({
      createdTargets: input.createdTargets,
      authorizingContainerIds: syncAuthorizingContainerIds(input.request),
      documentId: input.documentId,
      frontier: input.frontier,
      requireHeldHeads: input.requireHeldHeads,
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
  await lockSyncDocumentPullWatermark({
    documentId: input.documentId,
    tx: input.tx,
  });
  const lockedTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
    true,
  );
  if (
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

/**
 * What a seed may reuse from the transaction that carries it: a create's, or
 * an attachment bind's for the document's deferred first update.
 */
export interface CreateSeedContext {
  readonly createdDocumentSeed?: CreatedDocumentSeed | undefined;
  /** Actual rows read by the carrying transaction, with no later head writes. */
  readonly lockedContainerHeads?: LockedContainerHeadRows | undefined;
  /** A create inserted the document row itself; a bind's document exists. */
  readonly documentInsertedInTransaction: boolean;
  /**
   * A bind holds every head the write locks and has since locked blob rows,
   * so the write must refuse rather than lock a head late.
   */
  readonly headLocksHeld?: boolean | undefined;
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

function takeSyncCreateSeed(input: SyncDocumentWriteInput) {
  return input.seed?.documentInsertedInTransaction &&
    !input.request.containerRekeys?.length
    ? takeCreatedDocumentSeed({
        seed: input.seed.createdDocumentSeed,
        executor: input.tx,
        documentId: input.documentId,
      })
    : undefined;
}

async function principalPoliciesStillCurrent(
  executor: DatabaseTransaction,
  policies: readonly PrincipalPolicyAuthorization[],
): Promise<boolean> {
  if (policies.length === 0) return true;
  for (const principalType of [
    ...new Set(policies.map((policy) => policy.principalType)),
  ]) {
    const forType = policies.filter(
      (policy) => policy.principalType === principalType,
    );
    const current = await getCurrentPrincipalStates(
      principalType,
      forType.map((policy) => policy.principalId),
      executor,
    );
    for (const policy of forType) {
      const state = current.get(policy.principalId);
      if (
        !state ||
        state.version !== policy.version ||
        state.stateHash !== policy.stateHash
      ) {
        return false;
      }
    }
  }
  return true;
}

async function pullPathStillCurrent(
  executor: DatabaseTransaction,
  prelockAccess: VerifiedDocumentAccessResult,
): Promise<boolean> {
  const { principalPolicies, verifiedPath } = prelockAccess.access;
  const containerIds = verifiedPath.map((m) => m.state.containerId);
  const currentHeads = await getCurrentAccessManifestHeads(
    "container",
    containerIds,
    executor,
  );
  const headsMatch = verifiedPath.every(
    (m) =>
      currentHeads.get(m.state.containerId)?.manifestHash === m.manifestHash,
  );
  if (!headsMatch) return false;
  const liveOrgs = await loadLiveContainerOrganizations(executor, containerIds);
  const orgsMatch = verifiedPath.every(
    (m) => liveOrgs.get(m.state.containerId) === m.state.organizationId,
  );
  return (
    orgsMatch && principalPoliciesStillCurrent(executor, principalPolicies)
  );
}

async function canReusePrelockSyncAccess(params: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly frontier: DocumentLinkSetFrontier;
  readonly input: SyncDocumentWriteInput;
  readonly lockedContainerHeads:
    | Awaited<
        ReturnType<typeof lockSyncDocumentFrontier>
      >["lockedContainerHeads"]
    | undefined;
  readonly prelockAccess: VerifiedDocumentAccessResult;
}): Promise<boolean> {
  if ((params.input.request.containerRekeys?.length ?? 0) > 0) return false;
  if (params.input.request.outgoingUpdates.length === 0) {
    return (
      params.currentTargets.linkSetManifestHash ===
        params.frontier.linkSetManifestHash &&
      pullPathStillCurrent(params.input.tx, params.prelockAccess)
    );
  }
  const { lockedContainerHeads, prelockAccess } = params;
  const headsMatch =
    lockedContainerHeads !== undefined &&
    prelockAccess.access.verifiedPath.every(
      (m) =>
        lockedContainerHeads.get(m.state.containerId)?.manifestHash ===
        m.manifestHash,
    );
  return (
    headsMatch &&
    principalPoliciesStillCurrent(
      params.input.tx,
      prelockAccess.access.principalPolicies,
    )
  );
}

async function resolveLockedSyncDocumentAccess(params: {
  readonly createdDocument: ReturnType<typeof takeSyncCreateSeed>;
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly frontier: DocumentLinkSetFrontier;
  readonly input: SyncDocumentWriteInput;
  readonly lockedContainerHeads:
    | Awaited<
        ReturnType<typeof lockSyncDocumentFrontier>
      >["lockedContainerHeads"]
    | undefined;
  readonly prelockAccess: VerifiedDocumentAccessResult | undefined;
}): Promise<VerifiedDocumentAccessResult> {
  const { createdDocument, currentTargets, input, prelockAccess } = params;
  if (
    prelockAccess &&
    (await canReusePrelockSyncAccess({ ...params, prelockAccess }))
  ) {
    // Clear pre-lock container liveness cache so write proof verifies live
    // containers under the held frontier locks.
    prelockAccess.context.liveContainerOrganizationById.clear();
    return prelockAccess;
  }
  const reuseCreatedEvidence =
    createdDocument !== undefined &&
    createdDocument.targets.targets === currentTargets;
  return ensureSyncDocumentAccess({
    containerIds: currentTargets.targets.map((target) => target.containerId),
    context: reuseCreatedEvidence
      ? createdDocument.verifiedContainerContext
      : undefined,
    executor: input.tx,
    request: input.request,
    userId: input.userId,
    verifiedPrincipalPolicies: reuseCreatedEvidence
      ? createdDocument.verifiedPrincipalPolicies
      : undefined,
  });
}

async function authorizeLockedSyncDocumentWrite(params: {
  readonly createdDocument: ReturnType<typeof takeSyncCreateSeed>;
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly frontier: DocumentLinkSetFrontier;
  readonly input: SyncDocumentWriteInput;
  readonly lockedContainerHeads:
    | Awaited<
        ReturnType<typeof lockSyncDocumentFrontier>
      >["lockedContainerHeads"]
    | undefined;
  readonly prelockAccess: VerifiedDocumentAccessResult | undefined;
}) {
  const { createdDocument, currentTargets, input, lockedContainerHeads } =
    params;
  const reuseCreatedEvidence =
    createdDocument !== undefined &&
    createdDocument.targets.targets === currentTargets;
  const verifiedAccess = await resolveLockedSyncDocumentAccess(params);
  await assertSyncBillingAllowed(input, currentTargets.organizationId);
  // A lock excludes competing writers, not this transaction's own rekeys.
  // Carried seeds currently forbid rekeys; keep that boundary explicit here
  // too, rather than letting a future caller reuse a pre-rekey snapshot.
  const carriedHeads = input.request.containerRekeys?.length
    ? undefined
    : input.seed?.lockedContainerHeads;
  return verifySyncWriteAuthorizationProof({
    context: verifiedAccess.context,
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    lockedContainerHeads: new Map([
      ...(carriedHeads ?? []),
      ...(lockedContainerHeads ?? []),
    ]),
    request: input.request,
    verifiedPrincipalPolicies: [
      ...(reuseCreatedEvidence
        ? (createdDocument.verifiedPrincipalPolicies ?? [])
        : []),
      ...verifiedAccess.access.principalPolicies,
    ],
  });
}

export async function commitSyncDocumentWrites(
  input: SyncDocumentWriteInput,
): Promise<CommittedSyncDocumentWrites> {
  const createdDocument = takeSyncCreateSeed(input);
  const documentInsertedInTransaction =
    input.seed?.documentInsertedInTransaction ?? false;
  const { frontier, prelockAccess } = await prepareSyncDocumentTransaction({
    ...input,
    createdFrontier: createdDocument?.frontier,
    documentInsertedInTransaction,
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
      createdTargets: createdDocument?.targets,
      documentId: input.documentId,
      frontier,
      request: input.request,
      requireHeldHeads: input.seed?.headLocksHeld === true,
      tx: input.tx,
    });
  const currentTargets = lockedTargets.targets;
  const writeAuthorization = await authorizeLockedSyncDocumentWrite({
    createdDocument,
    currentTargets,
    frontier,
    input,
    lockedContainerHeads,
    prelockAccess,
  });
  // Must run before the bundle store below advances the latest epoch and
  // before the append inserts any baseline row.
  const stagedBaseline = await assertSyncRotationBaselinesSound({
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
    userId: input.userId,
  });
  const { contentKeyBundle, servedStaleBundle } =
    await resolveSyncContentKeyBundle({
      createdBundle:
        createdDocument &&
        createdDocument.targets.targets === lockedTargets.targets
          ? createdDocument.bundle
          : undefined,
      documentId: input.documentId,
      executor: input.tx,
      lockedTargets,
      request: input.request,
    });
  const appendResult = await appendDocumentUpdates({
    accessEpoch: resolveSyncAccessEpoch({ currentTargets, writeAuthorization }),
    contentKeyCommitment: contentKeyBundle.contentKeyCommitment,
    documentId: input.documentId,
    documentInsertedInTransaction,
    executor: input.tx,
    fingerprint: input.fingerprint,
    hasRestoredPeerOwners: createdDocument?.hasRestoredPeerOwners ?? true,
    organizationId: currentTargets.organizationId,
    request: input.request,
    signingPublicKey: input.signingPublicKey,
    stagedBaseline,
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
