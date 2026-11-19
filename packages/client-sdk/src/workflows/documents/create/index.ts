import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
} from "@tearleads/validators/response";
import { assertContainerAuthorAccess } from "../../../data/containers/shared/authorAccess";
import { buildDocumentCreatePlan } from "../../../data/documents/shared/events";
import { wrapDocumentContentKeyForCreate } from "../../../data/documents/shared/projection";
import { shouldRetryWithFreshProjection } from "../../../data/documents/shared/projection/freshProjectionRetry";
import type { ProjectionVerificationOptions } from "../../../data/documents/shared/projection/projectionVerificationOptions";
import { projectionVerificationOptions } from "../../../data/documents/shared/projection/projectionVerificationOptions";
import type {
  CreateRemoteDocumentResult,
  DocumentCreateApi,
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
} from "../../../data/documents/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  nullOnProjectionVerificationCancellation,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import { isContainerCreatePending } from "../../../data/persistence/documents/pendingContainerCreate";
import { openPrincipalPolicyBundleReader } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { recordDocumentAuthorAccessFailure } from "../authorAccessFailure";
import type { RemoteDocumentCollaborators } from "../remote/remoteDocumentCollaborators";
import {
  buildDocumentCreateSeedRequest,
  documentCreateSeed,
  documentCreateSeedFits,
  documentSyncFits,
} from "../sync/initialSync";
import { isDocumentManifestAlreadyExistsConflict } from "../syncFailures/syncFailureClassification";
import { adoptExistingRemoteDocument } from "./createAdoption";
import type { DocumentCreateTerminalFailureHandler } from "./createProjectionFetch";
import { fetchContainerWriterProjectionForCreate } from "./createProjectionFetch";
import {
  acknowledgeRemoteDocumentCreate,
  assertRequiredSeedAcknowledged,
} from "./createResponse";
import {
  type DocumentCreateSubmission,
  isStaleDocumentCreateTargetConflict,
  submitDocumentCreate,
} from "./createSubmission";
import type {
  DocumentSubmissionRequest,
  RemoteDocumentCreateInput,
} from "./remoteDocumentCreateRequest";

export async function buildMaterializedDocumentCreatePlan(
  input: {
    author: DocumentCreateAuthor;
    containerProjection: ContainerWriterProjectionResponse;
    contentKey?: Uint8Array | undefined;
    contentKeyEpoch?: number | undefined;
    documentId?: string | undefined;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
    persistVerificationCheckpoints?: boolean | undefined;
    signedAt?: string | undefined;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<MaterializedDocumentCreatePlan> {
  const contentKey =
    input.contentKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }
  // Resolved before wrapping: each envelope is sealed to its document and
  // content-key epoch.
  const documentId = input.documentId ?? crypto.randomUUID();
  const contentKeyEpoch = input.contentKeyEpoch ?? 1;
  const targetEnvelopes = await wrapDocumentContentKeyForCreate({
    contentKey,
    contentKeyEpoch,
    documentId,
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    persistVerificationCheckpoints: input.persistVerificationCheckpoints,
    projection: input.containerProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  if (input.resolveProjectionUserKey) {
    const principalPolicies =
      await collectContainerWriterProjectionPrincipalPolicies({
        ...projectionVerificationOptions(input),
        execSql: input.execSql,
        openPrincipalPolicyBundleReader,
        projection: input.containerProjection,
        resolveUserKey: input.resolveProjectionUserKey,
      });
    assertContainerAuthorAccess({
      // Document signing derives its organization from the verified target.
      author: {
        ...input.author,
        organizationId: input.containerProjection.organizationId,
      },
      projection: input.containerProjection,
      principalPolicies,
      minimumAccess: "write",
    });
  }
  // The explicit local-trust variant builds provisioning artifacts before
  // their new principal policies exist remotely; remote creates cannot use it.
  const plan = await buildDocumentCreatePlan({
    author: input.author,
    containerProjection: input.containerProjection,
    contentKeyEpoch,
    documentId,
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
    targetEnvelopes,
  });

  return {
    contentKey,
    plan,
  };
}

export { documentWriterProjectionFromCreateResponse } from "./createProjection";

interface MaterializedDocumentCreatePlanWithProjection {
  readonly containerProjection: ContainerWriterProjectionResponse;
  readonly materializedPlan: MaterializedDocumentCreatePlan;
}

async function buildMaterializedDocumentCreatePlanWithFreshProjection(input: {
  apiClient: DocumentCreateApi;
  author: DocumentCreateAuthor;
  containerId: string;
  containerProjection?: ContainerWriterProjectionResponse | undefined;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql: ExecSql;
  expectedOrganizationId?: string | undefined;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  onTerminalSubmitFailure?: DocumentCreateTerminalFailureHandler | undefined;
  persistVerificationCheckpoints?: boolean | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<MaterializedDocumentCreatePlanWithProjection | null> {
  const buildWithProjection = async (
    containerProjection: ContainerWriterProjectionResponse,
  ) => {
    if (
      containerProjection.containerId !== input.containerId ||
      (input.expectedOrganizationId !== undefined &&
        containerProjection.organizationId !== input.expectedOrganizationId)
    ) {
      throw new Error(
        "Container writer projection belongs to another container or organization",
      );
    }
    return {
      containerProjection,
      materializedPlan: await buildMaterializedDocumentCreatePlan({
        author: input.author,
        containerProjection,
        contentKey: input.contentKey,
        contentKeyEpoch: input.contentKeyEpoch,
        documentId: input.documentId,
        eventId: input.eventId,
        execSql: input.execSql,
        knownContainerKeks: input.knownContainerKeks,
        persistVerificationCheckpoints: input.persistVerificationCheckpoints,
        resolveProjectionUserKey: input.resolveProjectionUserKey,
        signedAt: input.signedAt,
        stillCurrent: input.stillCurrent,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      }),
    };
  };

  const containerProjection =
    input.containerProjection ??
    (await fetchContainerWriterProjectionForCreate({
      apiClient: input.apiClient,
      containerId: input.containerId,
      onTerminalSubmitFailure: input.onTerminalSubmitFailure,
    }));
  if (!containerProjection) {
    return null;
  }

  try {
    return await buildWithProjection(containerProjection);
  } catch (error) {
    if (
      !shouldRetryWithFreshProjection(error, (message) =>
        message.includes("could not be unwrapped"),
      )
    ) {
      throw error;
    }
  }

  // Only this container's projection was stale; evict just it rather than
  // wiping every cached projection.
  input.apiClient.evictContainerWriterProjection(input.containerId);
  const refreshedProjection = await fetchContainerWriterProjectionForCreate({
    apiClient: input.apiClient,
    containerId: input.containerId,
    onTerminalSubmitFailure: input.onTerminalSubmitFailure,
  });
  return refreshedProjection ? buildWithProjection(refreshedProjection) : null;
}

/**
 * A seed only saves the first sync. A refusal of the seeded create falls back
 * to the plain create once, so the row syncs as before and seeding adds no
 * failure mode. A lost response is adopted, and a stale target is replanned
 * with a fresh seed, exactly as for a plain create. Building the seed awaits
 * its encryption, so each submission rechecks the caller is still current and
 * returns null instead of creating a document whose response would be dropped.
 */
async function submitPlannedDocumentCreateRequest(
  input: RemoteDocumentCreateInput,
  createPlan: MaterializedDocumentCreatePlanWithProjection,
): Promise<DocumentCreateSubmission | null> {
  const request = createPlan.materializedPlan.plan.request;
  const organizationId = createPlan.containerProjection.organizationId;
  const canSubmit = () =>
    input.stillCurrent?.() !== false &&
    !isRemoteDocumentCreatePlanBlocked(input, createPlan);
  const seed = input.seedUpdate
    ? await buildDocumentCreateSeedRequest({
        author: input.author,
        containerProjection: createPlan.containerProjection,
        materializedDocument: createPlan.materializedPlan,
        pendingUpdate: input.seedUpdate,
      })
    : null;
  if (seed && documentCreateSeedFits(request, seed)) {
    if (!canSubmit()) return null;
    const seeded = await submitDocumentCreate(
      input.apiClient,
      { ...request, initialSync: documentCreateSeed(seed) },
      organizationId,
      canSubmit,
    );
    if (
      input.requireSeededCreate ||
      seeded.ok ||
      isDocumentManifestAlreadyExistsConflict(seeded) ||
      isStaleDocumentCreateTargetConflict(seeded)
    ) {
      return seeded;
    }
  }
  if (!canSubmit()) return null;
  if (input.requireSeededCreate)
    return {
      ok: false,
      status: null,
      message: "The initial document content must fit in one seeded create.",
    };
  return submitDocumentCreate(
    input.apiClient,
    request,
    organizationId,
    canSubmit,
  );
}

function isRemoteDocumentCreatePlanBlocked(
  input: RemoteDocumentCreateInput,
  createPlan: MaterializedDocumentCreatePlanWithProjection,
): boolean {
  const organizationId = createPlan.containerProjection.organizationId;
  return input.isRemoteSyncBlocked?.(organizationId) ?? false;
}

async function submitPlannedDocumentCreate(
  input: RemoteDocumentCreateInput,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<{
  readonly createPlan: MaterializedDocumentCreatePlanWithProjection;
  readonly retriedStaleTarget?: boolean;
  readonly submission: DocumentCreateSubmission;
} | null> {
  const verificationOptions = { stillCurrent: input.stillCurrent };
  const warmReferencedPrincipalPolicies = input.warmReferencedPrincipalPolicies;
  let createPlan = await buildMaterializedDocumentCreatePlanWithFreshProjection(
    {
      apiClient: input.apiClient,
      author: input.author,
      containerId: input.containerId,
      containerProjection: input.containerProjection,
      contentKey: input.contentKey,
      contentKeyEpoch: input.contentKeyEpoch,
      documentId: input.documentId,
      eventId: input.eventId,
      execSql: input.execSql,
      expectedOrganizationId: input.expectedOrganizationId,
      knownContainerKeks: input.knownContainerKeks,
      onTerminalSubmitFailure: input.onTerminalSubmitFailure,
      resolveProjectionUserKey,
      signedAt: input.signedAt,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies,
      ...verificationOptions,
    },
  );
  if (!createPlan) {
    return null;
  }
  if (isRemoteDocumentCreatePlanBlocked(input, createPlan)) return null;
  if (input.stillCurrent?.() === false) return null;
  let submission = await submitPlannedDocumentCreateRequest(input, createPlan);
  if (!submission) return null;
  if (!isStaleDocumentCreateTargetConflict(submission))
    return { createPlan, submission };
  if (input.stillCurrent?.() === false) {
    return { createPlan, submission };
  }
  input.apiClient.evictContainerWriterProjection(input.containerId);
  const firstPlan = createPlan.materializedPlan;
  const refreshedPlan =
    await buildMaterializedDocumentCreatePlanWithFreshProjection({
      apiClient: input.apiClient,
      author: input.author,
      containerId: input.containerId,
      contentKey: firstPlan.contentKey,
      contentKeyEpoch: firstPlan.plan.request.contentKeyBundle.contentKeyEpoch,
      documentId: firstPlan.plan.documentId,
      eventId: firstPlan.plan.event.eventId,
      execSql: input.execSql,
      expectedOrganizationId: input.expectedOrganizationId,
      knownContainerKeks: input.knownContainerKeks,
      onTerminalSubmitFailure: input.onTerminalSubmitFailure,
      resolveProjectionUserKey,
      signedAt: firstPlan.plan.event.signedAt,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies,
      ...verificationOptions,
    });
  if (!refreshedPlan) {
    return null;
  }
  if (isRemoteDocumentCreatePlanBlocked(input, refreshedPlan)) return null;
  createPlan = refreshedPlan;
  if (input.stillCurrent?.() === false) return null;
  submission = await submitPlannedDocumentCreateRequest(input, createPlan);
  if (!submission) return null;
  return { createPlan, submission, retriedStaleTarget: true };
}

/**
 * Signs the deferred first update against the plan the server just accepted,
 * without sending it, so the attachment bind that must precede it can carry
 * it. One that would not fit a sync request is left to sync on its own.
 */
async function withDeferredSeed(
  created: CreateRemoteDocumentResult,
  createPlan: MaterializedDocumentCreatePlanWithProjection,
  input: RemoteDocumentCreateInput,
): Promise<CreateRemoteDocumentResult> {
  if (!input.deferredSeedUpdate) return created;
  const deferredSeed = await buildDocumentCreateSeedRequest({
    author: input.author,
    containerProjection: createPlan.containerProjection,
    materializedDocument: createPlan.materializedPlan,
    pendingUpdate: input.deferredSeedUpdate,
  });
  return documentSyncFits(deferredSeed)
    ? { ...created, deferredSeed }
    : created;
}

async function settleSubmittedCreate(
  input: RemoteDocumentCreateInput,
  createPlan: MaterializedDocumentCreatePlanWithProjection,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
  response: DocumentCreateResponse,
  retriedStaleTarget: boolean | undefined,
) {
  const created = await acknowledgeRemoteDocumentCreate({
    ...input,
    ...createPlan,
    resolveProjectionUserKey,
    response,
  });
  assertRequiredSeedAcknowledged(input, created);
  if (input.stillCurrent?.() === false) return null;
  if (created && retriedStaleTarget) input.onRecoveredStaleTarget?.();
  return created && input.deferredSeedUpdate
    ? withDeferredSeed(created, createPlan, input)
    : created;
}

/** Throws when the collaborators carry no encapsulation secret key. */
export async function createRemoteDocument(
  remote: RemoteDocumentCollaborators,
  request: DocumentSubmissionRequest,
): Promise<CreateRemoteDocumentResult | null> {
  if (!remote.encapsulationSecretKey) {
    throw new Error("Remote document create requires an encapsulation key");
  }
  const input: RemoteDocumentCreateInput = {
    ...request,
    apiClient: remote.api,
    execSql: remote.execSql,
    isRemoteSyncBlocked: remote.isRemoteSyncBlocked,
    targetSecretKey: remote.encapsulationSecretKey,
  };
  // The store retries once the folder's own create settles.
  if (await isContainerCreatePending(input.execSql, input.containerId)) {
    return null;
  }
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document create",
  );
  const plannedSubmission = await recordDocumentAuthorAccessFailure(
    () =>
      nullOnProjectionVerificationCancellation(() =>
        submitPlannedDocumentCreate(input, resolveProjectionUserKey),
      ),
    input.onTerminalSubmitFailure,
  );
  if (!plannedSubmission) {
    return null;
  }
  const { createPlan, submission } = plannedSubmission;
  if (input.stillCurrent?.() === false) return null;
  if (submission.ok)
    return settleSubmittedCreate(
      input,
      createPlan,
      resolveProjectionUserKey,
      submission.data,
      plannedSubmission.retriedStaleTarget,
    );

  // A stable documentId means a retry after a lost create response re-submits
  // the same id; the server then reports the manifest already exists. That is
  // not a failure — the first attempt committed. Adopt the existing remote
  // document instead of leaking a duplicate. Requires the stable id we sent, so
  // we can fetch its projection back.
  const stableDocumentId = input.documentId;
  if (
    stableDocumentId &&
    !input.requireSeededCreate &&
    isDocumentManifestAlreadyExistsConflict(submission)
  ) {
    if (input.stillCurrent?.() === false) return null;
    const adopted = await nullOnProjectionVerificationCancellation(() =>
      adoptExistingRemoteDocument({
        apiClient: input.apiClient,
        documentId: stableDocumentId,
        execSql: input.execSql,
        expectedContainerId: input.containerId,
        expectedOrganizationId:
          input.expectedOrganizationId ??
          createPlan.containerProjection.organizationId,
        expectedSignerUserId: input.author.signerUserId,
        resolveProjectionUserKey,
        stillCurrent: input.stillCurrent,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      }),
    );
    if (adopted) {
      return adopted;
    }
    // A conflict is the expected, benign outcome of an idempotent retry after a
    // lost create response. If adoption cannot complete yet (e.g. the writer
    // projection fetch failed transiently), do not surface the conflict as a UI
    // error — the sync engine retries and adopts it on a later tick.
    return null;
  }

  // Create-only callers handle the refusal directly, including a verified purge.
  if (!input.requireSeededCreate) submission.report?.();
  await input.onTerminalSubmitFailure?.(submission);
  return null;
}
