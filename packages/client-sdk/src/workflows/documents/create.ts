import type {
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { buildDocumentCreatePlan } from "../../data/documents/shared/events";
import { acknowledgeDocumentMutation } from "../../data/documents/shared/mutationAcknowledgement";
import {
  assertDocumentWriterProjectionConsistent,
  unwrapDocumentContentKeyFromWriterProjection,
  wrapDocumentContentKeyForCreate,
} from "../../data/documents/shared/projection";
import {
  persistedDocumentCreateStateFromResponse,
  persistedDocumentCreateStateFromWriterProjection,
} from "../../data/documents/shared/responses";
import type {
  CreateRemoteDocumentResult,
  DocumentCreateApi,
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { DocumentCreateTerminalFailureHandler } from "./createProjectionFetch";
import { fetchContainerWriterProjectionForCreate } from "./createProjectionFetch";
import {
  isDocumentManifestAlreadyExistsConflict,
  projectionIntegrityErrorCode,
} from "./syncFailureClassification";

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
    signedAt?: string | undefined;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<MaterializedDocumentCreatePlan> {
  const contentKey =
    input.contentKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }
  const targetEnvelopes = await wrapDocumentContentKeyForCreate({
    contentKey,
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    projection: input.containerProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const plan = await buildDocumentCreatePlan({
    author: input.author,
    containerProjection: input.containerProjection,
    ...(input.contentKeyEpoch === undefined
      ? {}
      : { contentKeyEpoch: input.contentKeyEpoch }),
    ...(input.documentId === undefined ? {} : { documentId: input.documentId }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
    targetEnvelopes,
  });

  return {
    contentKey,
    plan,
  };
}

/**
 * Build the writer projection a document-create response establishes, from the
 * container projection the create was authored against plus the manifest,
 * content-key bundle, and KEK targets the server just returned. This is the
 * same material a cold `GET /documents/:id/writer-projection` would yield, so
 * seeding it lets the first read after a create resolve locally. Shared by the
 * plain document-create path and the container-with-metadata-document path,
 * whose response carries an equivalent `DocumentCreateResponse`.
 */
export function documentWriterProjectionFromCreateResponse(input: {
  containerProjection: ContainerWriterProjectionResponse;
  response: DocumentCreateResponse;
}): DocumentWriterProjectionResponse {
  return {
    authorizingContainerPaths: [input.containerProjection],
    contentKeyBundle: input.response.contentKeyBundle,
    documentContainerManifestHistory: [
      ...input.containerProjection.path,
      ...input.containerProjection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ],
    documentId: input.response.id,
    documentKekTargets: input.response.documentKekTargets,
    documentManifest: input.response.accessManifest,
    documentManifestContainerPaths: [[...input.containerProjection.path]],
    documentManifestHistory: [],
  };
}

function shouldRetryWithFreshContainerProjection(error: unknown): boolean {
  const integrityErrorCode = projectionIntegrityErrorCode(error);
  if (integrityErrorCode) {
    return integrityErrorCode === "rollback";
  }
  if (isKeyingVerificationError(error)) {
    return false;
  }

  return (
    error instanceof Error && error.message.includes("could not be unwrapped")
  );
}

interface MaterializedDocumentCreatePlanWithProjection {
  readonly containerProjection: ContainerWriterProjectionResponse;
  readonly materializedPlan: MaterializedDocumentCreatePlan;
}

async function buildMaterializedDocumentCreatePlanWithFreshProjection(input: {
  apiClient: DocumentCreateApi;
  author: DocumentCreateAuthor;
  containerId: string;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql: ExecSql;
  onTerminalSubmitFailure?: DocumentCreateTerminalFailureHandler | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<MaterializedDocumentCreatePlanWithProjection | null> {
  const buildWithProjection = async (
    containerProjection: ContainerWriterProjectionResponse,
  ) => ({
    containerProjection,
    materializedPlan: await buildMaterializedDocumentCreatePlan({
      author: input.author,
      containerProjection,
      contentKey: input.contentKey,
      contentKeyEpoch: input.contentKeyEpoch,
      documentId: input.documentId,
      eventId: input.eventId,
      execSql: input.execSql,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      signedAt: input.signedAt,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
  });

  const containerProjection = await fetchContainerWriterProjectionForCreate({
    apiClient: input.apiClient,
    containerId: input.containerId,
    onTerminalSubmitFailure: input.onTerminalSubmitFailure,
  });
  if (!containerProjection) {
    return null;
  }

  try {
    return await buildWithProjection(containerProjection);
  } catch (error) {
    if (
      !input.apiClient.evictContainerWriterProjection ||
      !shouldRetryWithFreshContainerProjection(error)
    ) {
      throw error;
    }
  }

  // Only this container's projection was stale; evict just it rather than
  // wiping every cached projection.
  input.apiClient.evictContainerWriterProjection?.(input.containerId);
  const refreshedProjection = await fetchContainerWriterProjectionForCreate({
    apiClient: input.apiClient,
    containerId: input.containerId,
    onTerminalSubmitFailure: input.onTerminalSubmitFailure,
  });
  return refreshedProjection ? buildWithProjection(refreshedProjection) : null;
}

interface RemoteDocumentCreateInput {
  apiClient: DocumentCreateApi;
  author: DocumentCreateAuthor;
  containerId: string;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql: ExecSql;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  /**
   * Invoked when the create submission fails terminally (not a benign
   * adopt/stale-target conflict) — e.g. the server denies the write. Callers
   * persist the failure so the write queue can surface it.
   */
  onTerminalSubmitFailure?:
    | ((failure: {
        readonly message: string;
        readonly status: number | null;
      }) => Promise<void> | void)
    | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

async function submitPlannedDocumentCreate(
  input: RemoteDocumentCreateInput,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<{
  readonly createPlan: MaterializedDocumentCreatePlanWithProjection;
  readonly submission: DocumentCreateSubmission;
} | null> {
  let createPlan = await buildMaterializedDocumentCreatePlanWithFreshProjection(
    {
      apiClient: input.apiClient,
      author: input.author,
      containerId: input.containerId,
      contentKey: input.contentKey,
      contentKeyEpoch: input.contentKeyEpoch,
      documentId: input.documentId,
      eventId: input.eventId,
      execSql: input.execSql,
      onTerminalSubmitFailure: input.onTerminalSubmitFailure,
      resolveProjectionUserKey,
      signedAt: input.signedAt,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    },
  );
  if (!createPlan) {
    return null;
  }
  if (
    input.isRemoteSyncBlocked?.(createPlan.containerProjection.organizationId)
  ) {
    return null;
  }

  let submission = await submitDocumentCreate(
    input.apiClient,
    createPlan.materializedPlan.plan.request,
  );
  if (
    isStaleDocumentCreateTargetConflict(submission) &&
    input.apiClient.evictContainerWriterProjection
  ) {
    input.apiClient.evictContainerWriterProjection(input.containerId);
    const firstPlan = createPlan.materializedPlan;
    const refreshedPlan =
      await buildMaterializedDocumentCreatePlanWithFreshProjection({
        apiClient: input.apiClient,
        author: input.author,
        containerId: input.containerId,
        contentKey: firstPlan.contentKey,
        contentKeyEpoch:
          firstPlan.plan.request.contentKeyBundle.contentKeyEpoch,
        documentId: firstPlan.plan.documentId,
        eventId: firstPlan.plan.event.eventId,
        execSql: input.execSql,
        onTerminalSubmitFailure: input.onTerminalSubmitFailure,
        resolveProjectionUserKey,
        signedAt: firstPlan.plan.event.signedAt,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
    if (!refreshedPlan) {
      return null;
    }
    if (
      input.isRemoteSyncBlocked?.(
        refreshedPlan.containerProjection.organizationId,
      )
    ) {
      return null;
    }
    createPlan = refreshedPlan;
    submission = await submitDocumentCreate(
      input.apiClient,
      createPlan.materializedPlan.plan.request,
    );
  }

  return { createPlan, submission };
}

export async function createRemoteDocument(
  input: RemoteDocumentCreateInput,
): Promise<CreateRemoteDocumentResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document create",
  );
  const plannedSubmission = await submitPlannedDocumentCreate(
    input,
    resolveProjectionUserKey,
  );
  if (!plannedSubmission) {
    return null;
  }
  const { createPlan, submission } = plannedSubmission;
  if (submission.ok) {
    const response = submission.data;
    const persistedState = persistedDocumentCreateStateFromResponse(
      createPlan.materializedPlan.plan,
      response,
    );
    await acknowledgeDocumentMutation({
      execSql: input.execSql,
      plan: createPlan.materializedPlan.plan,
    });
    const writerProjection = documentWriterProjectionFromCreateResponse({
      containerProjection: createPlan.containerProjection,
      response,
    });
    // Seed the projection the create response already gave us so the first read
    // after create (sync, blob attach, container-contents hydration) resolves
    // locally instead of a cold GET writer-projection.
    input.apiClient.primeDocumentWriterProjection(
      response.id,
      writerProjection,
    );

    return {
      contentKey: createPlan.materializedPlan.contentKey,
      documentId: response.id,
      persistedState,
      plan: createPlan.materializedPlan.plan,
      response,
      writerProjection,
    };
  }

  // A stable documentId means a retry after a lost create response re-submits
  // the same id; the server then reports the manifest already exists. That is
  // not a failure — the first attempt committed. Adopt the existing remote
  // document instead of leaking a duplicate. Requires the stable id we sent, so
  // we can fetch its projection back.
  if (input.documentId && isDocumentManifestAlreadyExistsConflict(submission)) {
    const adopted = await adoptExistingRemoteDocument({
      apiClient: input.apiClient,
      documentId: input.documentId,
      execSql: input.execSql,
      resolveProjectionUserKey,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    if (adopted) {
      return adopted;
    }
    // A conflict is the expected, benign outcome of an idempotent retry after a
    // lost create response. If adoption cannot complete yet (e.g. the writer
    // projection fetch failed transiently), do not surface the conflict as a UI
    // error — the sync engine retries and adopts it on a later tick.
    return null;
  }

  submission.report?.();
  await input.onTerminalSubmitFailure?.(submission);
  return null;
}

type DocumentCreateSubmission =
  | {
      readonly data: DocumentCreateResponse;
      readonly ok: true;
    }
  | {
      readonly message: string;
      readonly ok: false;
      readonly report?: (() => void) | undefined;
      readonly status: number | null;
    };

function isStaleDocumentCreateTargetConflict(
  submission: DocumentCreateSubmission,
): boolean {
  return (
    !submission.ok &&
    submission.status === 409 &&
    submission.message.includes("targetContainerPathRefs") &&
    submission.message.includes("is stale")
  );
}

async function submitDocumentCreate(
  apiClient: DocumentCreateApi,
  request: DocumentCreateRequest,
): Promise<DocumentCreateSubmission> {
  // Prefer the result-returning variant so an expected create conflict can be
  // inspected without being reported as a UI error. Fall back to the plain
  // method for simple test doubles; that path cannot adopt (it surfaces a null
  // without a status) and preserves the pre-existing behavior.
  if (apiClient.createDocumentResult) {
    return apiClient.createDocumentResult(request, { reportErrors: false });
  }
  const response = await apiClient.createDocument(request);
  return response
    ? { data: response, ok: true }
    : { message: "", ok: false, status: null };
}

/**
 * Adopts an already-committed remote document after a create conflict: refetch
 * its writer projection, recover the content key from it (the key generated for
 * this attempt is not what the committed manifest wraps, and is gone after a
 * restart), and rebuild the persisted create-state. Returns null if the
 * projection cannot be fetched yet, so the caller falls back to reporting.
 */
async function adoptExistingRemoteDocument(
  input: {
    apiClient: DocumentCreateApi;
    documentId: string;
    execSql: ExecSql;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<CreateRemoteDocumentResult | null> {
  if (!input.apiClient.getDocumentWriterProjection) {
    return null;
  }
  const writerProjection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (!writerProjection) {
    return null;
  }

  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const principalPolicyCache = new Map<string, VerifiedPrincipalPolicy>();
  await assertDocumentWriterProjectionConsistent(writerProjection, {
    execSql: input.execSql,
    principalPolicyCache,
    verifiedByHash,
    ...projectionVerificationOptions(input),
  });
  const contentKey = await unwrapDocumentContentKeyFromWriterProjection({
    execSql: input.execSql,
    principalPolicyCache,
    secretKey: input.targetSecretKey,
    verifiedByHash,
    writerProjection,
    ...projectionVerificationOptions(input),
  });

  input.apiClient.primeDocumentWriterProjection(
    writerProjection.documentId,
    writerProjection,
  );

  return {
    contentKey,
    documentId: writerProjection.documentId,
    persistedState:
      persistedDocumentCreateStateFromWriterProjection(writerProjection),
    writerProjection,
  };
}
