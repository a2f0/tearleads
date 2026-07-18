import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  signWriteHeader,
  type UnsignedWriteHeader,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  ContainerManifestRef,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  isAccessManifestBundleWireResponse,
  isDocumentContentKeyBundleResponse,
  isDocumentKekTargetsResponse,
} from "@tearleads/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import {
  decryptDocumentSyncUpdatesByEpoch,
  encryptDocumentPendingUpdate,
  importDocumentContentKeyMaterial,
} from "../../data/documents/shared/crypto";
import {
  assertDocumentWriterProjectionConsistent,
  authorizingContainerPathRefs,
  collectContainerKeksForDocumentSync,
  unwrapDocumentContentKeyFromBundle,
  unwrapDocumentContentKeyFromWriterProjection,
} from "../../data/documents/shared/projection";
import {
  assertDocumentManifestBundleConsistent,
  normalizeDocumentKekTargetResponse,
  readWriteHeader,
  serializeCanonical,
  sortDocumentTargets,
  targetEnvelopeReference,
} from "../../data/documents/shared/readers";
import {
  isRetryableDocumentSyncConflict,
  persistedDocumentSyncStateFromResponse,
  submitDocumentSync,
} from "../../data/documents/shared/responses";
import type {
  BuildDocumentSyncPlanInput,
  DocumentCreateAuthor,
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentSyncPreparedUpdate,
  DocumentWriterPublicKeyResolver,
  MaterializedDocumentSyncPlan,
  PersistedDocumentSyncState,
  ProjectionVerificationOptions,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  handleUpstreamDeletedDocumentSyncFailure,
  projectionIntegrityErrorCode,
  REMOTE_DOCUMENT_DELETED,
  type RemoteDocumentDeletionHandler,
  resolveDocumentSyncWriterProjection,
  retrySyncPlan,
  submitDocumentSyncAttemptIfAllowed,
} from "./syncFailures";
import {
  type RekeyPendingUpdate,
  rekeyUnsettledRecoveryPendingUpdates,
  settledPendingUpdateIdsFromSync,
} from "./syncRecoveryRekey";

export function hasDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  documentId: string | null | undefined,
): boolean {
  if (!documentId) {
    return false;
  }

  return events.some(
    (event) =>
      isDocumentUpdateCreatedEvent(event) && event.documentId === documentId,
  );
}

async function prepareDocumentOutgoingUpdates(input: {
  contentKey: Uint8Array;
  documentId: string;
  organizationId: string;
  pendingUpdates: readonly PendingUpdateRecord[];
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<DocumentSyncPreparedUpdate[]> {
  if (input.pendingUpdates.length === 0) {
    return [];
  }
  const contentKeyMaterial = await importDocumentContentKeyMaterial(
    input.contentKey,
  );

  return Promise.all(
    input.pendingUpdates.map(async (update) => {
      const encrypted = await encryptDocumentPendingUpdate({
        contentKeyMaterial,
        contentKeyEpoch:
          input.writerProjection.contentKeyBundle.contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      });

      return {
        contentRecordId: encrypted.contentRecordId,
        encryptedData: encrypted.encryptedData,
        id: update.id,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        metadataHash: encrypted.metadataHash,
        ciphertextHash: encrypted.ciphertextHash,
        ...(update.sourceVersionVector
          ? {
              checkpointKind: "rotate_baseline" as const,
              checkpointPayloadKind: "full_history_snapshot" as const,
              sourceVersionVector: update.sourceVersionVector,
            }
          : {}),
      };
    }),
  );
}

function syncResponseContentKeyBundlesByEpoch(
  response: DocumentSyncResponse,
): ReadonlyMap<number, DocumentSyncResponse["contentKeyBundle"]> {
  const byEpoch = new Map<number, DocumentSyncResponse["contentKeyBundle"]>();

  for (const bundle of [
    response.contentKeyBundle,
    ...response.contentKeyBundles,
  ]) {
    const existing = byEpoch.get(bundle.contentKeyEpoch);
    if (!existing) {
      byEpoch.set(bundle.contentKeyEpoch, bundle);
      continue;
    }
    if (
      serializeCanonical(existing, "content-key bundle") !==
      serializeCanonical(bundle, "content-key bundle")
    ) {
      throw new Error("Document sync response content-key bundle conflict");
    }
  }

  return byEpoch;
}

async function unwrapDocumentSyncResponseContentKeys(
  input: {
    currentContentKey: Uint8Array;
    currentContentKeyEpoch: number;
    execSql?: ExecSql | undefined;
    response: DocumentSyncResponse;
    targetSecretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<ReadonlyMap<number, Uint8Array>> {
  const contentKeysByEpoch = new Map<number, Uint8Array>([
    [input.currentContentKeyEpoch, input.currentContentKey],
  ]);
  const bundlesByEpoch = syncResponseContentKeyBundlesByEpoch(input.response);
  const neededContentKeyEpochs = new Set(
    input.response.updates.map(
      (update) =>
        readWriteHeader(
          update.writeHeader,
          "Document sync response write header",
        ).contentKeyEpoch,
    ),
  );
  const missingBundles = [...neededContentKeyEpochs]
    .filter((contentKeyEpoch) => !contentKeysByEpoch.has(contentKeyEpoch))
    .map((contentKeyEpoch) => bundlesByEpoch.get(contentKeyEpoch));
  if (missingBundles.length === 0) {
    return contentKeysByEpoch;
  }

  const containerKeksByEpochId = await collectContainerKeksForDocumentSync({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  for (const bundle of missingBundles) {
    if (!bundle) {
      throw new Error("Document sync response content-key bundle missing");
    }
    contentKeysByEpoch.set(
      bundle.contentKeyEpoch,
      await unwrapDocumentContentKeyFromBundle(bundle, containerKeksByEpochId),
    );
  }

  return contentKeysByEpoch;
}

export async function buildMaterializedDocumentSyncPlan(
  input: {
    author: DocumentCreateAuthor;
    execSql?: ExecSql | undefined;
    localVersionVector: string | null;
    minLsn?: string | undefined;
    pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
    signedAt?: string | undefined;
    targetSecretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<MaterializedDocumentSyncPlan> {
  // Reuse verification across consistency and unwrap passes; unwrap still
  // binds the key material independently.
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const principalPolicyCache = new Map<string, VerifiedPrincipalPolicy>();
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
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
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  const documentId = input.writerProjection.documentId;
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document sync manifest",
  });
  const outgoingUpdates = await prepareDocumentOutgoingUpdates({
    contentKey,
    documentId,
    organizationId: manifestIdentity.organizationId,
    pendingUpdates: input.pendingUpdates ?? [],
    writerProjection: input.writerProjection,
  });
  const plan = await buildDocumentSyncPlan({
    author: {
      ...input.author,
      organizationId: manifestIdentity.organizationId,
    },
    authorizingContainerPathRefs: authorizingContainerPathRefs(
      input.writerProjection,
    ),
    contentKeyBundle: input.writerProjection.contentKeyBundle,
    documentId,
    documentKekTargets: input.writerProjection.documentKekTargets,
    documentManifest: input.writerProjection.documentManifest,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    outgoingUpdates,
    signedAt: input.signedAt,
  });

  return {
    contentKey,
    plan,
  };
}

function contentKeyBundleForSyncRequest(
  input: DocumentCreateResponse["contentKeyBundle"],
): NonNullable<DocumentSyncRequest["contentKeyBundle"]> {
  const { documentId: _omit, ...bundle } = input;
  return bundle;
}

async function syncRemoteDocumentResultFromResponse(input: {
  execSql: ExecSql;
  materializedPlan: MaterializedDocumentSyncPlan;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  response: DocumentSyncResponse;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<SyncRemoteDocumentResult> {
  const { plan } = input.materializedPlan;
  const persistedState = await persistedDocumentSyncStateFromResponse(
    plan,
    input.response,
    {
      resolveWriterPublicKey: input.resolveWriterPublicKey,
      writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
    },
  );
  const contentKeysByEpoch = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: input.materializedPlan.contentKey,
    currentContentKeyEpoch: plan.contentKeyEpoch,
    execSql: input.execSql,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  const decryptedUpdates = await decryptDocumentSyncUpdatesByEpoch({
    contentKeysByEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    updates: input.response.updates,
  });
  const settledPendingUpdateIds = settledPendingUpdateIdsFromSync({
    decryptedUpdates,
    recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
    response: input.response,
  });
  const rekeyedPendingUpdateIds = await rekeyUnsettledRecoveryPendingUpdates({
    execSql: input.execSql,
    recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
    rekeyPendingUpdate: input.rekeyPendingUpdate,
    settledPendingUpdateIds,
  });

  return {
    contentKey: input.materializedPlan.contentKey,
    decryptedUpdates,
    persistedState,
    plan,
    rekeyedPendingUpdateIds,
    response: input.response,
    settledPendingUpdateIds,
    writerProjection: input.writerProjection,
  };
}

async function completeReadOnlyRemoteDocumentSyncWithProjection(input: {
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  response: DocumentSyncResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection: DocumentWriterProjectionResponse;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<SyncRemoteDocumentResult> {
  const materializedPlan = await buildMaterializedDocumentSyncPlan({
    author: input.author,
    execSql: input.execSql,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    pendingUpdates: [],
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  return syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input),
    execSql: input.execSql,
    materializedPlan,
    recoveryPendingUpdatesById: new Map(),
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
}

function parsePersistedDocumentSyncRecord<T>(
  value: string | null | undefined,
  label: string,
  isRecord: (value: unknown) => value is T,
): T | null {
  if (!value) {
    return null;
  }

  try {
    const record = readCanonicalRecord(JSON.parse(value), label);
    return isRecord(record) ? record : null;
  } catch {
    return null;
  }
}

function parsePersistedDocumentSyncState(
  persistedState: PersistedDocumentSyncState | null | undefined,
  documentId: string,
): {
  contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
} | null {
  if (persistedState?.documentId !== documentId) {
    return null;
  }

  const contentKeyBundle = parsePersistedDocumentSyncRecord(
    persistedState.contentKeyBundle,
    "Persisted document sync content-key bundle",
    isDocumentContentKeyBundleResponse,
  );
  const documentKekTargets = parsePersistedDocumentSyncRecord(
    persistedState.documentKekTargets,
    "Persisted document sync KEK targets",
    isDocumentKekTargetsResponse,
  );
  const documentManifest = parsePersistedDocumentSyncRecord(
    persistedState.documentManifestBundle,
    "Persisted document sync manifest",
    isAccessManifestBundleWireResponse,
  );

  if (!contentKeyBundle || !documentKekTargets || !documentManifest) {
    return null;
  }

  return {
    contentKeyBundle,
    documentKekTargets,
    documentManifest,
  };
}

async function buildReadOnlyDocumentSyncPlanFromPersistedState(input: {
  author: DocumentCreateAuthor;
  documentId: string;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  signedAt?: string | undefined;
}): Promise<DocumentSyncPlan | null> {
  const persisted = parsePersistedDocumentSyncState(
    input.persistedState,
    input.documentId,
  );
  if (!persisted) {
    return null;
  }

  return buildDocumentSyncPlan({
    author: input.author,
    contentKeyBundle: persisted.contentKeyBundle,
    documentId: input.documentId,
    documentKekTargets: persisted.documentKekTargets,
    documentManifest: persisted.documentManifest,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    outgoingUpdates: [],
    signedAt: input.signedAt,
  });
}

type PersistedReadOnlyDocumentSyncResult =
  | {
      kind: "completed";
      result: SyncRemoteDocumentResult | null;
    }
  | {
      kind: "retry_with_projection";
    }
  | {
      kind: "skipped";
    };

interface ReadOnlyDocumentSyncCompletionInput {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  response: DocumentSyncResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}

async function tryCompleteReadOnlyRemoteDocumentSyncWithProjection(input: {
  completion: ReadOnlyDocumentSyncCompletionInput;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<SyncRemoteDocumentResult | null> {
  try {
    return await completeReadOnlyRemoteDocumentSyncWithProjection({
      ...input.completion,
      writerProjection: input.writerProjection,
    });
  } catch (error) {
    rethrowKeyingVerificationError(error);
    if (projectionIntegrityErrorCode(error)) {
      throw error;
    }
    return null;
  }
}

async function completeReadOnlyRemoteDocumentSyncWithUpdates(
  input: ReadOnlyDocumentSyncCompletionInput,
): Promise<PersistedReadOnlyDocumentSyncResult> {
  const reusableWriterProjection =
    input.writerProjection?.documentId === input.documentId
      ? input.writerProjection
      : null;
  const writerProjection =
    reusableWriterProjection ??
    (await input.apiClient.getDocumentWriterProjection(input.documentId));
  if (!writerProjection) {
    return { kind: "completed", result: null };
  }

  let result: SyncRemoteDocumentResult | null = null;
  let retryAfterRollback = false;
  try {
    result = await tryCompleteReadOnlyRemoteDocumentSyncWithProjection({
      completion: input,
      writerProjection,
    });
  } catch (error) {
    if (projectionIntegrityErrorCode(error) !== "rollback") {
      throw error;
    }
    retryAfterRollback = true;
  }
  if (result || (!retryAfterRollback && !reusableWriterProjection)) {
    return { kind: "completed", result };
  }

  if (input.apiClient.evictDocumentWriterProjection) {
    input.apiClient.evictDocumentWriterProjection(input.documentId);
  } else {
    input.apiClient.clearWriterProjectionCaches?.();
  }
  const freshWriterProjection =
    await input.apiClient.getDocumentWriterProjection(input.documentId);
  if (!freshWriterProjection) {
    return { kind: "completed", result: null };
  }

  const freshResult = await tryCompleteReadOnlyRemoteDocumentSyncWithProjection(
    {
      completion: input,
      writerProjection: freshWriterProjection,
    },
  );
  return freshResult
    ? { kind: "completed", result: freshResult }
    : { kind: "retry_with_projection" };
}

async function syncReadOnlyRemoteDocumentFromPersistedState(input: {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<PersistedReadOnlyDocumentSyncResult> {
  let plan: DocumentSyncPlan | null;
  try {
    plan = await buildReadOnlyDocumentSyncPlanFromPersistedState(input);
  } catch {
    plan = null;
  }
  if (!plan) {
    return { kind: "skipped" };
  }

  const submitted = await submitDocumentSync({
    apiClient: input.apiClient,
    plan,
  });
  if (!submitted) {
    return { kind: "completed", result: null };
  }
  if (!submitted.ok) {
    if (
      await handleUpstreamDeletedDocumentSyncFailure({
        documentId: input.documentId,
        failure: submitted,
        onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      })
    ) {
      return { kind: "completed", result: null };
    }

    if (isRetryableDocumentSyncConflict(submitted)) {
      return { kind: "retry_with_projection" };
    }

    submitted.report();
    return { kind: "completed", result: null };
  }

  if (submitted.response.updates.length > 0) {
    return completeReadOnlyRemoteDocumentSyncWithUpdates({
      ...input,
      response: submitted.response,
    });
  }

  try {
    const persistedState = await persistedDocumentSyncStateFromResponse(
      plan,
      submitted.response,
    );

    return {
      kind: "completed",
      result: {
        contentKey: new Uint8Array(),
        decryptedUpdates: [],
        persistedState,
        plan,
        rekeyedPendingUpdateIds: [],
        response: submitted.response,
        settledPendingUpdateIds: [],
      },
    };
  } catch {
    return { kind: "retry_with_projection" };
  }
}

async function resolveDocumentSyncIdentity(
  input: BuildDocumentSyncPlanInput,
): Promise<{
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
}> {
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.documentManifest,
    label: "Document sync manifest",
  });
  const documentId = input.documentId ?? input.contentKeyBundle.documentId;
  if (documentId.length === 0) {
    throw new Error("Document sync document id is empty");
  }
  if (
    input.contentKeyBundle.documentId !== documentId ||
    input.documentKekTargets.documentId !== documentId ||
    manifestIdentity.documentId !== documentId
  ) {
    throw new Error("Document sync state document id mismatch");
  }
  if (manifestIdentity.organizationId !== input.author.organizationId) {
    throw new Error("Document sync author organization mismatch");
  }
  if (
    input.documentManifest.manifestHash !==
      input.contentKeyBundle.linkSetManifestHash ||
    input.documentKekTargets.linkSetManifestHash !==
      input.contentKeyBundle.linkSetManifestHash
  ) {
    throw new Error("Document sync link manifest mismatch");
  }
  if (
    input.documentKekTargets.documentKeyTargetHash !==
    input.contentKeyBundle.targetHash
  ) {
    throw new Error("Document sync target hash mismatch");
  }

  const kekTargets = normalizeDocumentKekTargetResponse(
    input.documentKekTargets,
  );
  const contentKeyTargets = sortDocumentTargets(
    input.contentKeyBundle.targets.map(targetEnvelopeReference),
  );
  if (
    serializeCanonical(kekTargets, "KEK targets") !==
    serializeCanonical(contentKeyTargets, "content-key targets")
  ) {
    throw new Error("Document sync content-key targets mismatch");
  }

  const targetHash = await computeDocumentContentKeyTargetHash(kekTargets);
  if (targetHash !== input.contentKeyBundle.targetHash) {
    throw new Error("Document sync target hash is not canonical");
  }

  return {
    documentId,
    expectedLinkSetManifestHash: input.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: input.contentKeyBundle.targetHash,
    organizationId: manifestIdentity.organizationId,
  };
}

function normalizeAuthorizingContainerPathRefs(
  refs: readonly (readonly ContainerManifestRef[])[] | undefined,
): ContainerManifestRef[][] {
  if (!refs || refs.length === 0) {
    throw new Error("Document sync write authorization path refs are missing");
  }

  return refs.map((path, pathIndex) => {
    if (path.length === 0) {
      throw new Error(
        `Document sync write authorization path[${pathIndex}] is empty`,
      );
    }
    return [...path];
  });
}

export async function signDocumentOutgoingUpdate(input: {
  author: DocumentCreateAuthor;
  contentKeyEpoch: number;
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
  signedAt: string;
  update: DocumentSyncPreparedUpdate;
}): Promise<DocumentOutgoingUpdate> {
  const contentRecordId = input.update.contentRecordId ?? input.update.id;
  const nonceDomain = {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  } as const;
  const unsignedHeader: UnsignedWriteHeader = {
    ...nonceDomain,
    accessManifestHash: input.expectedLinkSetManifestHash,
    targetHash: input.expectedTargetHash,
    nonceDomainHash: await computeContentRecordNonceDomainHash(nonceDomain),
    metadataHash: input.update.metadataHash,
    ciphertextHash: input.update.ciphertextHash,
    writerUserId: input.author.signerUserId,
    writerDeviceId: input.author.signerDeviceId,
    writerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.update.signedAt ?? input.signedAt,
  };
  const writeHeader = await signWriteHeader(
    unsignedHeader,
    input.author.signerPrivateKey,
  );

  return {
    ...(input.update.checkpointKind === undefined
      ? {}
      : { checkpointKind: input.update.checkpointKind }),
    ...(input.update.checkpointPayloadKind === undefined
      ? {}
      : { checkpointPayloadKind: input.update.checkpointPayloadKind }),
    id: input.update.id,
    encryptedData: input.update.encryptedData,
    partialStartVersionVector: input.update.partialStartVersionVector,
    partialEndVersionVector: input.update.partialEndVersionVector,
    ...(input.update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: input.update.sourceVersionVector }),
    writeHeader: readCanonicalRecord(
      writeHeader,
      "Document outgoing write header",
    ),
  };
}

function assertUniqueDocumentOutgoingUpdates(
  updates: readonly DocumentSyncPreparedUpdate[],
): void {
  const updateIds = new Set<string>();
  const contentRecordIds = new Set<string>();
  for (const update of updates) {
    if (updateIds.has(update.id)) {
      throw new Error("Document sync update id is duplicated");
    }
    updateIds.add(update.id);

    const contentRecordId = (update.contentRecordId ?? update.id).toLowerCase();
    if (contentRecordIds.has(contentRecordId)) {
      throw new Error("Document sync content record id is duplicated");
    }
    contentRecordIds.add(contentRecordId);
  }
}

interface SyncRemoteDocumentInput {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}

async function tryPersistedReadOnlyDocumentSync(
  input: SyncRemoteDocumentInput,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<PersistedReadOnlyDocumentSyncResult | null> {
  if ((input.pendingUpdates ?? []).length > 0) {
    return null;
  }

  return syncReadOnlyRemoteDocumentFromPersistedState({
    apiClient: input.apiClient,
    author: input.author,
    documentId: input.documentId,
    execSql: input.execSql,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    persistedState: input.persistedState,
    resolveProjectionUserKey,
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    writerProjection: input.writerProjection,
    writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
  });
}

export async function buildDocumentSyncPlan(
  input: BuildDocumentSyncPlanInput,
): Promise<DocumentSyncPlan> {
  const {
    documentId,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    organizationId,
  } = await resolveDocumentSyncIdentity(input);
  const outgoingUpdateInputs = [...(input.outgoingUpdates ?? [])];
  const signedAt = input.signedAt ?? new Date().toISOString();
  assertUniqueDocumentOutgoingUpdates(outgoingUpdateInputs);

  const outgoingUpdates = await Promise.all(
    outgoingUpdateInputs.map((update) =>
      signDocumentOutgoingUpdate({
        author: input.author,
        contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
        documentId,
        expectedLinkSetManifestHash,
        expectedTargetHash,
        organizationId,
        signedAt,
        update,
      }),
    ),
  );
  // Writes always carry the verified current content-key bundle so the server
  // can validate and materialize the current wrapping material in the same
  // request. Read-only syncs omit it because they do not update server state.
  const shouldIncludeContentKeyBundle = outgoingUpdates.length > 0;
  const request: DocumentSyncRequest = {
    ...(shouldIncludeContentKeyBundle
      ? {
          contentKeyBundle: contentKeyBundleForSyncRequest(
            input.contentKeyBundle,
          ),
        }
      : {}),
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    ...(outgoingUpdates.length === 0
      ? {}
      : {
          authorizingContainerPathRefs: normalizeAuthorizingContainerPathRefs(
            input.authorizingContainerPathRefs,
          ),
        }),
    expectedLinkSetManifestHash,
    expectedTargetHash,
    localVersionVector: input.localVersionVector,
    ...(input.minLsn === undefined ? {} : { minLsn: input.minLsn }),
    outgoingUpdates,
  };

  return {
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId,
    documentKekTargets: input.documentKekTargets,
    documentManifest: input.documentManifest,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    minLsn: input.minLsn,
    organizationId,
    request,
    sourceContentKeyBundle: input.contentKeyBundle,
  };
}

function buildRemoteDocumentSyncPlan(input: {
  pendingUpdates: readonly PendingUpdateRecord[];
  projection: DocumentWriterProjectionResponse;
  sync: SyncRemoteDocumentInput;
}) {
  return buildMaterializedDocumentSyncPlan({
    author: input.sync.author,
    execSql: input.sync.execSql,
    localVersionVector: input.sync.localVersionVector,
    minLsn: input.sync.minLsn,
    pendingUpdates: input.pendingUpdates,
    signedAt: input.sync.signedAt,
    targetSecretKey: input.sync.targetSecretKey,
    writerProjection: input.projection,
    ...projectionVerificationOptions(input.sync),
  });
}

export async function syncRemoteDocument(
  input: SyncRemoteDocumentInput,
): Promise<SyncRemoteDocumentResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document sync",
  );
  const maxAttempts = input.apiClient.syncDocumentResult ? 3 : 1;
  let pendingUpdates = input.pendingUpdates ?? [];
  let recoveryPendingUpdatesById = new Map<string, PendingUpdateRecord>();
  let reusableWriterProjection = input.writerProjection ?? null;

  const persistedSync = await tryPersistedReadOnlyDocumentSync(
    input,
    resolveProjectionUserKey,
  );
  if (persistedSync?.kind === "completed") {
    return persistedSync.result;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const writerProjection = await resolveDocumentSyncWriterProjection({
      apiClient: input.apiClient,
      documentId: input.documentId,
      reusableWriterProjection,
    });
    reusableWriterProjection = null;
    if (writerProjection === REMOTE_DOCUMENT_DELETED) {
      await input.onRemoteDocumentDeleted?.({ documentId: input.documentId });
      return null;
    }
    if (!writerProjection) {
      return null;
    }
    const planned = await retrySyncPlan({
      apiClient: input.apiClient,
      buildWithProjection: (projection) =>
        buildRemoteDocumentSyncPlan({
          pendingUpdates,
          projection,
          sync: input,
        }),
      documentId: input.documentId,
      onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      writerProjection,
    });
    if (!planned) {
      return null;
    }
    const [materializedPlan, plannedWriterProjection] = planned;
    const plan = materializedPlan.plan;
    const submitted = await submitDocumentSyncAttemptIfAllowed({
      apiClient: input.apiClient,
      attempt,
      documentId: input.documentId,
      isRemoteSyncBlocked: input.isRemoteSyncBlocked,
      maxAttempts,
      onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      pendingUpdates,
      plan,
    });
    if (submitted === "retry") {
      // A retryable stale-projection conflict (stale KEK targets / content-key
      // bundle / write-auth manifest) means our writer projection is behind the
      // server — typically right after a peer shared or rotated a linked
      // container. Drop this document's cached projection so the next attempt
      // re-derives fresh targets instead of resubmitting the same stale ones
      // (which would 409 again and exhaust the retries without converging).
      // Scoped to this document: unrelated projections were not invalidated.
      input.apiClient.evictDocumentWriterProjection?.(input.documentId);
      continue;
    }
    if (submitted !== "stop" && submitted.kind !== "completed") {
      recoveryPendingUpdatesById = submitted.recoveryPendingUpdatesById;
      pendingUpdates = [];
      continue;
    }
    if (submitted === "stop") {
      return null;
    }

    return syncRemoteDocumentResultFromResponse({
      ...projectionVerificationOptions(input),
      execSql: input.execSql,
      materializedPlan,
      recoveryPendingUpdatesById,
      rekeyPendingUpdate: input.rekeyPendingUpdate,
      resolveWriterPublicKey: input.resolveWriterPublicKey,
      response: submitted.response,
      targetSecretKey: input.targetSecretKey,
      writerProjection: plannedWriterProjection,
      writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
      resolveProjectionUserKey,
    });
  }

  return null;
}
