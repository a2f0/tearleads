import {
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  DocumentContentKeyTargetEnvelope,
  DocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { buildDocumentLinkSetEventPlan } from "../../data/documents/shared/events";
import {
  assertDocumentWriterProjectionConsistent,
  collectContainerKeksForDocumentSync,
  containerPathRefs,
  currentDocumentTargets,
  deriveDocumentTargetFromProjection,
  mergeTargetEnvelopes,
  readLinkedContainerIdsFromDocumentManifest,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyFromWriterProjection,
} from "../../data/documents/shared/projection";
import {
  assertDocumentManifestBundleConsistent,
  describeDocumentTargetKek,
  sortDocumentTargets,
  targetKey,
  uniqueSortedStrings,
} from "../../data/documents/shared/readers";
import {
  type BuildDocumentLinkSetMutationPlanInput,
  type DocumentCreateAuthor,
  type DocumentLinkSetFailureHandler,
  type DocumentLinkSetMutationApi,
  type DocumentLinkSetMutationOperation,
  type DocumentLinkSetMutationPlan,
  type DocumentLinkSetTargetState,
  type MaterializedDocumentLinkSetMutationPlan,
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
  type RelinkRemoteDocumentResult,
  resolveProjectionVerifier,
} from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import {
  type PrincipalPolicyCache,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
  verifyContainerWriterProjection,
} from "../../data/keyingProjectionVerification";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { persistAcknowledgedLinkSetState } from "./linkSetAcknowledgement";
import { seedLinkSetWriterProjection } from "./linkSetProjectionSeed";
import { completeLinkSetMutationRequest } from "./rotationBaseline";

function deriveDocumentLinkSetTargetState(input: {
  operation: DocumentLinkSetMutationOperation;
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
}): DocumentLinkSetTargetState {
  const currentTargets = currentDocumentTargets(input.writerProjection);
  const currentLinkedContainerIds = readLinkedContainerIdsFromDocumentManifest(
    input.writerProjection,
  );
  const target = deriveDocumentTargetFromProjection(
    input.targetContainerProjection,
  );
  const currentTarget = currentTargets.find(
    (candidate) => candidate.containerId === target.containerId,
  );

  if (input.operation === "link") {
    if (currentTarget) {
      throw new Error("Document link target is already linked");
    }

    return {
      currentTargets,
      linkedContainerIds: uniqueSortedStrings([
        ...currentLinkedContainerIds,
        target.containerId,
      ]),
      target,
      targets: sortDocumentTargets([...currentTargets, target]),
    };
  }

  if (!currentTarget) {
    throw new Error("Document unlink target is not linked");
  }
  if (targetKey(currentTarget) !== targetKey(target)) {
    throw new Error("Document unlink target projection is stale");
  }

  const linkedContainerIds = currentLinkedContainerIds.filter(
    (containerId) => containerId !== target.containerId,
  );
  if (linkedContainerIds.length === 0) {
    throw new Error("Document unlink must leave a linked container");
  }

  return {
    currentTargets,
    linkedContainerIds,
    target,
    targets: currentTargets.filter(
      (candidate) => candidate.containerId !== target.containerId,
    ),
  };
}

async function wrapDocumentContentKeyForTargets(input: {
  contentKey: Uint8Array;
  keksByEpochId: ReadonlyMap<string, Uint8Array>;
  targets: readonly DocumentContentKeyTarget[];
}): Promise<DocumentContentKeyTargetEnvelope[]> {
  return Promise.all(
    sortDocumentTargets(input.targets).map(async (target) => {
      const targetKek = input.keksByEpochId.get(target.containerKeyEpochId);
      if (!targetKek) {
        throw new Error(
          `Document target KEK could not be unwrapped for ${describeDocumentTargetKek(target)}`,
        );
      }

      const wrapped = await encryptWithDek(input.contentKey, targetKek);
      return {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      };
    }),
  );
}

// Resolve the organization a link/unlink mutation belongs to: the document's
// own org (from its manifest), which must equal the target container's org —
// both are owned by the same organization. The acting member's personal org is
// intentionally not part of this check; a member may link documents within any
// org they belong to. Returns the document org so the plan stamps it onto the
// signed event and manifest rather than the author's org.
async function resolveDocumentLinkSetMutationOrganization(input: {
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<string> {
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document link-set manifest",
  });
  if (
    manifestIdentity.organizationId !==
    input.targetContainerProjection.organizationId
  ) {
    throw new Error("Document target container organization mismatch");
  }

  return manifestIdentity.organizationId;
}

async function verifyDocumentLinkSetTargetContainerProjection(
  input: {
    execSql?: ExecSql | undefined;
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    targetContainerProjection: ContainerWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<void> {
  resolveProjectionVerifier(
    input,
    "Document link-set target container projection",
  );
  if (input.trustedLocalProjection === true) {
    return;
  }

  try {
    await verifyContainerWriterProjection({
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      projection: input.targetContainerProjection,
      resolveUserKey: input.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  } catch (error) {
    throwKeyingVerificationErrorWithContext(
      error,
      "Document link-set target container projection verification failed",
    );
  }
}

function readDocumentLinkSetPreviousEpoch(
  writerProjection: DocumentWriterProjectionResponse,
): number {
  const previousState = writerProjection.documentManifest.state;
  const previousEpoch = isPlainRecord(previousState)
    ? Reflect.get(previousState, "epoch")
    : undefined;
  if (
    typeof previousEpoch !== "number" ||
    !Number.isInteger(previousEpoch) ||
    previousEpoch <= 0
  ) {
    throw new Error("Document link-set previous epoch is invalid");
  }

  return previousEpoch;
}

async function buildDocumentLinkSetMutationPlan({
  author,
  contentKeyEpoch,
  eventId = crypto.randomUUID(),
  operation,
  signedAt = new Date().toISOString(),
  targetContainerProjection,
  targetEnvelopes,
  writerProjection,
}: BuildDocumentLinkSetMutationPlanInput): Promise<DocumentLinkSetMutationPlan> {
  const organizationId = await resolveDocumentLinkSetMutationOrganization({
    targetContainerProjection,
    writerProjection,
  });
  const targetState = deriveDocumentLinkSetTargetState({
    operation,
    targetContainerProjection,
    writerProjection,
  });
  const targetEnvelopesForRequest = mergeTargetEnvelopes(
    targetState.targets,
    targetEnvelopes,
  );
  const eventPlan = await buildDocumentLinkSetEventPlan({
    author,
    eventId,
    operation,
    organizationId,
    signedAt,
    targetState,
    writerProjection,
  });
  const previousEpoch = readDocumentLinkSetPreviousEpoch(writerProjection);

  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: writerProjection.documentId,
    organizationId,
    epoch: previousEpoch + 1,
    previousManifestHash: writerProjection.documentManifest.manifestHash,
    eventHash: eventPlan.eventHash,
    linkedContainerIds: [...targetState.linkedContainerIds],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash(
    targetState.targets,
  );

  return {
    body: eventPlan.body,
    contentKeyEpoch,
    documentId: writerProjection.documentId,
    event: eventPlan.event,
    eventHash: eventPlan.eventHash,
    manifest,
    manifestHash,
    operation,
    request: {
      event: readCanonicalRecord(eventPlan.event, "Document link-set event"),
      body: readCanonicalRecord(eventPlan.body, "Document link-set body"),
      expectedManifestHash: manifestHash,
      manifest: readCanonicalRecord(manifest, "Document link-set manifest"),
      targetContainerPathRefs: containerPathRefs(
        targetContainerProjection.path,
      ),
      authorizingContainerPathRefs: eventPlan.authorizingContainerPathRefs,
      contentKeyBundle: {
        contentKeyEpoch,
        linkSetManifestHash: manifestHash,
        targetHash,
        targets: targetEnvelopesForRequest,
      },
    },
    state,
    targetHash,
    targets: sortDocumentTargets(targetState.targets),
  };
}

export async function buildMaterializedDocumentLinkSetMutationPlan(
  input: {
    author: DocumentCreateAuthor;
    contentKey?: Uint8Array | undefined;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    operation: DocumentLinkSetMutationOperation;
    signedAt?: string | undefined;
    targetContainerProjection: ContainerWriterProjectionResponse;
    targetSecretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<MaterializedDocumentLinkSetMutationPlan> {
  const verificationOptions = projectionVerificationOptions(input);
  const principalPolicyCache: PrincipalPolicyCache = new Map();
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
    execSql: input.execSql,
    principalPolicyCache,
    ...verificationOptions,
  });
  await verifyDocumentLinkSetTargetContainerProjection({
    execSql: input.execSql,
    principalPolicyCache,
    targetContainerProjection: input.targetContainerProjection,
    ...verificationOptions,
  });
  const targetState = deriveDocumentLinkSetTargetState({
    operation: input.operation,
    targetContainerProjection: input.targetContainerProjection,
    writerProjection: input.writerProjection,
  });
  const currentContentKey = await unwrapDocumentContentKeyFromWriterProjection({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...verificationOptions,
  });
  const contentKeyRotated = input.operation === "unlink";
  const contentKey = contentKeyRotated
    ? (input.contentKey ?? crypto.getRandomValues(new Uint8Array(32)))
    : currentContentKey;
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }

  const targetEnvelopes =
    input.operation === "link"
      ? [
          ...input.writerProjection.contentKeyBundle.targets,
          ...(await wrapDocumentContentKeyForTargets({
            contentKey,
            keksByEpochId: await unwrapContainerKekPath({
              execSql: input.execSql,
              projection: input.targetContainerProjection,
              secretKey: input.targetSecretKey,
              ...verificationOptions,
            }),
            targets: [targetState.target],
          })),
        ]
      : await wrapDocumentContentKeyForTargets({
          contentKey,
          keksByEpochId: await collectContainerKeksForDocumentSync({
            execSql: input.execSql,
            secretKey: input.targetSecretKey,
            writerProjection: input.writerProjection,
            ...verificationOptions,
          }),
          targets: targetState.targets,
        });

  const plan = await buildDocumentLinkSetMutationPlan({
    author: input.author,
    contentKeyEpoch:
      input.writerProjection.contentKeyBundle.contentKeyEpoch +
      (contentKeyRotated ? 1 : 0),
    eventId: input.eventId,
    operation: input.operation,
    signedAt: input.signedAt,
    targetContainerProjection: input.targetContainerProjection,
    targetEnvelopes,
    writerProjection: input.writerProjection,
  });

  return {
    contentKey,
    contentKeyRotated,
    plan,
  };
}

async function submitLinkSetMutation(input: {
  apiClient: DocumentLinkSetMutationApi;
  documentId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  operation: DocumentLinkSetMutationOperation;
  request: DocumentLinkSetMutationRequest;
}): Promise<DocumentLinkSetMutationResponse | null> {
  const { apiClient } = input;
  // Prefer the result-returning variants so a failure keeps its HTTP status
  // instead of collapsing to null — the move-intent queue records it.
  const resultFn =
    input.operation === "link"
      ? apiClient.linkDocumentResult?.bind(apiClient)
      : apiClient.unlinkDocumentResult?.bind(apiClient);
  if (resultFn) {
    const result = await resultFn(input.documentId, input.request);
    if (result.ok) {
      return result.data;
    }
    input.onFailure?.({ message: result.message, status: result.status });
    return null;
  }

  const response =
    input.operation === "link"
      ? await apiClient.linkDocument(input.documentId, input.request)
      : await apiClient.unlinkDocument(input.documentId, input.request);
  if (!response) {
    input.onFailure?.({
      message: `Document ${input.operation} request failed`,
      status: null,
    });
  }
  return response;
}

interface LinkSetProjectionFetch<TProjection> {
  failure: { message: string; status: number | null } | null;
  projection: TProjection | null;
}

// Cold-cache projection fetches must keep their HTTP status: collapsing a
// 403 to null would leave an access-denied link/unlink routinely retriable
// instead of parking its move for the access-restored signal (row 7).
async function fetchLinkSetDocumentProjection(
  apiClient: DocumentLinkSetMutationApi,
  documentId: string,
): Promise<LinkSetProjectionFetch<DocumentWriterProjectionResponse>> {
  if (apiClient.getDocumentWriterProjectionResult) {
    const result = await apiClient.getDocumentWriterProjectionResult(
      documentId,
      { reportErrors: false },
    );
    if (result.ok) {
      return { failure: null, projection: result.data };
    }
    result.report();
    return {
      failure: { message: result.message, status: result.status },
      projection: null,
    };
  }
  const projection = await apiClient.getDocumentWriterProjection(documentId);
  return projection
    ? { failure: null, projection }
    : {
        failure: {
          message: "Document writer projection is unavailable",
          status: null,
        },
        projection: null,
      };
}

async function fetchLinkSetContainerProjection(
  apiClient: DocumentLinkSetMutationApi,
  containerId: string,
): Promise<LinkSetProjectionFetch<ContainerWriterProjectionResponse>> {
  if (apiClient.getContainerWriterProjectionResult) {
    const result = await apiClient.getContainerWriterProjectionResult(
      containerId,
      { reportErrors: false },
    );
    if (result.ok) {
      return { failure: null, projection: result.data };
    }
    result.report();
    return {
      failure: { message: result.message, status: result.status },
      projection: null,
    };
  }
  const projection = await apiClient.getContainerWriterProjection(containerId);
  return projection
    ? { failure: null, projection }
    : {
        failure: {
          message: "Container writer projection is unavailable",
          status: null,
        },
        projection: null,
      };
}

export async function relinkRemoteDocument(input: {
  apiClient: DocumentLinkSetMutationApi;
  author: DocumentCreateAuthor;
  contentKey?: Uint8Array | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  operation: DocumentLinkSetMutationOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot?: Uint8Array | undefined;
  signedAt?: string | undefined;
  targetContainerId: string;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<RelinkRemoteDocumentResult | null> {
  if (input.operation === "unlink" && !input.rotationSnapshot) {
    throw new Error(
      "Document unlink requires a proven full-history rotation snapshot",
    );
  }
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document link-set mutation",
  );
  const [writerFetch, targetContainerFetch] = await Promise.all([
    fetchLinkSetDocumentProjection(input.apiClient, input.documentId),
    fetchLinkSetContainerProjection(input.apiClient, input.targetContainerId),
  ]);
  const projectionFailure = writerFetch.failure ?? targetContainerFetch.failure;
  if (!writerFetch.projection || !targetContainerFetch.projection) {
    if (projectionFailure) {
      input.onFailure?.(projectionFailure);
    }
    return null;
  }
  const writerProjection = writerFetch.projection;
  const targetContainerProjection = targetContainerFetch.projection;

  const signedAt = input.signedAt ?? new Date().toISOString();
  const materializedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    author: input.author,
    contentKey: input.contentKey,
    eventId: input.eventId,
    execSql: input.execSql,
    operation: input.operation,
    resolveProjectionUserKey,
    signedAt,
    targetContainerProjection,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    writerProjection,
  });
  const request = await completeLinkSetMutationRequest({
    author: input.author,
    materializedPlan,
    operation: input.operation,
    rotationSnapshot: input.rotationSnapshot,
    signedAt,
  });
  const completedPlan = { ...materializedPlan.plan, request };
  const response = await submitLinkSetMutation({
    apiClient: input.apiClient,
    documentId: completedPlan.documentId,
    onFailure: input.onFailure,
    operation: input.operation,
    request: completedPlan.request,
  });
  if (!response) {
    return null;
  }
  const persistedState = await persistAcknowledgedLinkSetState({
    execSql: input.execSql,
    plan: completedPlan,
    response,
  });

  await seedLinkSetWriterProjection({
    apiClient: input.apiClient,
    execSql: input.execSql,
    operation: input.operation,
    priorProjection: writerProjection,
    response,
    targetContainerId: input.targetContainerId,
    targetContainerProjection,
  });

  return {
    contentKey: materializedPlan.contentKey,
    contentKeyRotated: materializedPlan.contentKeyRotated,
    documentId: response.id,
    linkedContainerIds: [...materializedPlan.plan.state.linkedContainerIds],
    persistedState,
    plan: completedPlan,
    response,
  };
}
