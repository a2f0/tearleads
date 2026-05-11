import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  signWriteHeader,
  type UnsignedWriteHeader,
} from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import {
  decryptDocumentSyncUpdatesByEpoch,
  encryptDocumentPendingUpdate,
  importDocumentContentKeyMaterial,
} from "../../data/documents/shared/crypto";
import {
  assertDocumentWriterProjectionConsistent,
  authorizingContainerPathRecords,
  collectContainerKeksForDocumentSync,
  unwrapDocumentContentKeyFromWriterProjection,
  unwrapDocumentContentKeyTarget,
} from "../../data/documents/shared/projection";
import {
  assertDocumentManifestBundleConsistent,
  assertEqualBytes,
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
  DocumentSyncSubmitFailure,
  DocumentWriterPublicKeyResolver,
  MaterializedDocumentSyncPlan,
  ProjectionVerificationOptions,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type DocumentAuthorRuntime,
  resolveDocumentCreateAuthor,
} from "./author";
import {
  createDocumentWriterPublicKeyResolver,
  type DocumentWriterPublicKeyRuntime,
} from "./writerKeys";

type RemoteDocumentSyncRuntime = DocumentAuthorRuntime &
  DocumentWriterPublicKeyRuntime & {
    apiClient: DocumentSyncApi & DocumentWriterPublicKeyRuntime["apiClient"];
    execSql?: ExecSql | undefined;
  };

interface RemoteDocumentSyncAttempt {
  outgoingUpdateCount: number;
  synced: SyncRemoteDocumentResult;
}

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
    ...(response.contentKeyBundles ?? []),
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

async function unwrapDocumentContentKeyFromBundle(input: {
  bundle: DocumentSyncResponse["contentKeyBundle"];
  containerKeksByEpochId: ReadonlyMap<string, Uint8Array>;
}): Promise<Uint8Array> {
  let contentKey: Uint8Array | null = null;

  for (const envelope of input.bundle.targets) {
    const containerKek = input.containerKeksByEpochId.get(
      envelope.containerKeyEpochId,
    );
    if (!containerKek) {
      continue;
    }

    const unwrapped = await unwrapDocumentContentKeyTarget({
      containerKek,
      envelope,
    });
    if (contentKey) {
      assertEqualBytes(
        contentKey,
        unwrapped,
        "Document sync content-key bundle unwraps to conflicting keys",
      );
      continue;
    }
    contentKey = unwrapped;
  }

  if (!contentKey) {
    throw new Error("Document sync content-key bundle could not be unwrapped");
  }
  if (contentKey.byteLength !== 32) {
    throw new Error("Document sync content key must be 32 bytes");
  }

  return contentKey;
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
      await unwrapDocumentContentKeyFromBundle({
        bundle,
        containerKeksByEpochId,
      }),
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
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
    execSql: input.execSql,
    ...projectionVerificationOptions(input),
  });
  const contentKey = await unwrapDocumentContentKeyFromWriterProjection({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
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
    authorizingContainerPaths: authorizingContainerPathRecords(
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
  bundle: DocumentCreateResponse["contentKeyBundle"],
): NonNullable<DocumentSyncRequest["contentKeyBundle"]> {
  return {
    contentKeyEpoch: bundle.contentKeyEpoch,
    linkSetManifestHash: bundle.linkSetManifestHash,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map((target) => ({
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: target.wrappingMetadata,
    })),
  };
}

function isRecoverableDocumentUpdateIdConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.message.includes("Document update id conflict")
  );
}

function settledPendingUpdateIdsFromSync(input: {
  decryptedUpdates: readonly { id: string }[];
  recoveryPendingUpdateIds: ReadonlySet<string>;
  response: DocumentSyncResponse;
}): string[] {
  const settled = new Set(input.response.acceptedOutgoingUpdateIds);

  for (const update of input.decryptedUpdates) {
    if (input.recoveryPendingUpdateIds.has(update.id)) {
      settled.add(update.id);
    }
  }

  return [...settled];
}

async function syncRemoteDocumentResultFromResponse(input: {
  execSql?: ExecSql | undefined;
  materializedPlan: MaterializedDocumentSyncPlan;
  recoveryPendingUpdateIds: ReadonlySet<string>;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
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
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
  });
  const decryptedUpdates = await decryptDocumentSyncUpdatesByEpoch({
    contentKeysByEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    updates: input.response.updates,
  });

  return {
    contentKey: input.materializedPlan.contentKey,
    decryptedUpdates,
    persistedState,
    plan,
    response: input.response,
    settledPendingUpdateIds: settledPendingUpdateIdsFromSync({
      decryptedUpdates,
      recoveryPendingUpdateIds: input.recoveryPendingUpdateIds,
      response: input.response,
    }),
    writerProjection: input.writerProjection,
  };
}

function manifestBundleForSyncRequest(
  bundle: DocumentCreateResponse["accessManifest"],
): NonNullable<DocumentSyncRequest["documentManifest"]> {
  return {
    event: bundle.event,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state: bundle.state,
  };
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

function normalizeAuthorizingContainerPaths(
  paths: readonly (readonly Record<string, unknown>[])[] | undefined,
): Record<string, unknown>[][] {
  if (!paths || paths.length === 0) {
    throw new Error("Document sync write authorization paths are missing");
  }

  return paths.map((path, pathIndex) => {
    if (path.length === 0) {
      throw new Error(
        `Document sync write authorization path[${pathIndex}] is empty`,
      );
    }
    return path.map((bundle, bundleIndex) => {
      if (!isPlainRecord(bundle)) {
        throw new Error(
          `Document sync write authorization path[${pathIndex}][${bundleIndex}] is invalid`,
        );
      }
      return bundle;
    });
  });
}

async function signDocumentOutgoingUpdate(input: {
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
          documentManifest: manifestBundleForSyncRequest(
            input.documentManifest,
          ),
          authorizingContainerPaths: normalizeAuthorizingContainerPaths(
            input.authorizingContainerPaths,
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

export async function syncRemoteDocument(input: {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql?: ExecSql | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<SyncRemoteDocumentResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document sync",
  );
  // syncDocumentResult is the canonical proxy for retry-capable API clients

  const maxAttempts = input.apiClient.syncDocumentResult ? 3 : 1;
  let pendingUpdates = input.pendingUpdates ?? [];
  let recoveryPendingUpdateIds = new Set<string>();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const writerProjection = await input.apiClient.getDocumentWriterProjection(
      input.documentId,
    );
    if (!writerProjection) {
      return null;
    }
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author: input.author,
      execSql: input.execSql,
      localVersionVector: input.localVersionVector,
      minLsn: input.minLsn,
      pendingUpdates,
      resolveProjectionUserKey,
      signedAt: input.signedAt,
      targetSecretKey: input.targetSecretKey,
      writerProjection,
    });
    const plan = materializedPlan.plan;
    const submitted = await submitDocumentSync({
      apiClient: input.apiClient,
      plan,
    });
    if (!submitted) {
      return null;
    }
    if (!submitted.ok) {
      if (
        attempt < maxAttempts &&
        isRetryableDocumentSyncConflict(submitted as DocumentSyncSubmitFailure)
      ) {
        continue;
      }
      if (
        attempt < maxAttempts &&
        pendingUpdates.length > 0 &&
        isRecoverableDocumentUpdateIdConflict(
          submitted as DocumentSyncSubmitFailure,
        )
      ) {
        recoveryPendingUpdateIds = new Set(
          pendingUpdates.map((update) => update.id),
        );
        pendingUpdates = [];
        continue;
      }

      (submitted as DocumentSyncSubmitFailure).report();
      return null;
    }

    return syncRemoteDocumentResultFromResponse({
      execSql: input.execSql,
      materializedPlan,
      recoveryPendingUpdateIds,
      resolveProjectionUserKey,
      resolveWriterPublicKey: input.resolveWriterPublicKey,
      response: submitted.response,
      targetSecretKey: input.targetSecretKey,
      writerProjection,
      writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
    });
  }

  return null;
}

export async function syncRemoteDocumentFromRuntime(input: {
  documentId: string | null | undefined;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  logPrefix?: string | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: RemoteDocumentSyncRuntime;
  targetSecretKey: Uint8Array;
  unavailableWriterLogMessage: string;
  writerKeyLabel?: string | undefined;
}): Promise<RemoteDocumentSyncAttempt | null> {
  const {
    documentId,
    lastCommitLsn,
    localVersionVector,
    pendingUpdates,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  } = input;
  if (!documentId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.log(input.unavailableWriterLogMessage);
    return null;
  }

  const synced = await syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    documentId,
    execSql: runtime.execSql,
    localVersionVector,
    minLsn: lastCommitLsn ?? undefined,
    pendingUpdates,
    resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: input.logPrefix ?? "Documents",
      runtime,
      writerKeyLabel: input.writerKeyLabel ?? "writer key",
    }),
    targetSecretKey,
  });
  if (!synced) {
    return null;
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
  };
}
