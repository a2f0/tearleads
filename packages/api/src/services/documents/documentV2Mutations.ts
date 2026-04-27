import type {
  AccessEventV2,
  AccessManifestV2,
  ContainerAccessManifestStateV2,
  KeyingV2CanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
  VerifiedWriteHeader,
  WriteHeaderV2,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeWriteHeaderHash,
  deriveContainerAccessManifest,
  deriveDocumentLinkSetManifest,
  KeyingV2VerificationError,
  serializeKeyingV2CanonicalJson,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
  verifyWriteHeader,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  ContainerV2ManifestBundle,
  DocumentV2ContentKeyBundleRequest,
  DocumentV2ContentKeyTargetEnvelope,
  DocumentV2CreateRequest,
  DocumentV2ManifestBundle,
  DocumentV2OutgoingUpdate,
  DocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentV2ContentKeyBundleResponse,
  DocumentV2CreateResponse,
  DocumentV2KekTargetsResponse,
  DocumentV2SyncResponse,
} from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import {
  getCurrentAccessManifestHead,
  storeVerifiedAccessManifest,
} from "../../access/accessManifestStore";
import {
  canReadDocumentAccess,
  canWriteDocumentAccess,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import {
  DocumentContentKeyBundleError,
  listDocumentContentWriteHeaders,
  requireCurrentDocumentContentKeyBundle,
  type DocumentContentKeyTargetEnvelope as StoredDocumentContentKeyTargetEnvelope,
  storeDocumentContentKeyBundle,
  storeDocumentContentWriteHeader,
} from "../../access/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../../access/documentKekTargets";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  documentContainerLinks,
  documents,
  documentUpdates,
  users,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";
import type { ApiServiceRuntime } from "../runtime";
import { readCurrentCommitLsn } from "./commitLsn";
import { createDocumentSyncStore } from "./documentSyncStore";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";

type DocumentV2MutationStatus = 400 | 403 | 404 | 409 | 503;

export class DocumentV2MutationError extends Error {
  constructor(
    message: string,
    readonly status: DocumentV2MutationStatus,
  ) {
    super(message);
    this.name = "DocumentV2MutationError";
  }
}

interface CreateDocumentV2Input {
  readonly fingerprint: string;
  readonly request: DocumentV2CreateRequest;
  readonly userId: string;
}

interface SyncDocumentV2Input {
  readonly documentId: string;
  readonly fingerprint: string;
  readonly request: DocumentV2SyncRequest;
  readonly userId: string;
}

function canonicalJsonEquals(left: unknown, right: unknown): boolean {
  return (
    serializeKeyingV2CanonicalJson(left as KeyingV2CanonicalJson) ===
    serializeKeyingV2CanonicalJson(right as KeyingV2CanonicalJson)
  );
}

function mapVerificationStatus(
  error: KeyingV2VerificationError,
): DocumentV2MutationStatus {
  if (
    error.code === "signature_mismatch" ||
    error.code === "signer_mismatch" ||
    error.code === "unauthorized"
  ) {
    return 403;
  }

  if (
    error.code === "invalid_domain" ||
    error.code === "invalid_shape" ||
    error.code === "object_mismatch"
  ) {
    return 400;
  }

  return 409;
}

function toMutationError(error: unknown): DocumentV2MutationError | null {
  if (error instanceof DocumentV2MutationError) {
    return error;
  }

  if (error instanceof DocumentContentKeyBundleError) {
    return new DocumentV2MutationError(error.message, error.status);
  }

  if (error instanceof KeyingV2VerificationError) {
    return new DocumentV2MutationError(
      error.message,
      mapVerificationStatus(error),
    );
  }

  return null;
}

async function loadSignerPublicKey(
  executor: DatabaseExecutor,
  input: {
    readonly fingerprint: string;
    readonly userId: string;
  },
): Promise<Uint8Array> {
  const [user] = await executor
    .select({
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user || user.fingerprint !== input.fingerprint) {
    throw new DocumentV2MutationError("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}

async function verifyDocumentEvent(input: {
  readonly body: unknown;
  readonly executor: DatabaseExecutor;
  readonly expectedDocumentId?: string;
  readonly expectedEventType?: AccessEventV2["eventType"];
  readonly event: Record<string, unknown>;
  readonly fingerprint: string;
  readonly userId: string;
}): Promise<VerifiedAccessEvent> {
  const event = input.event as unknown as AccessEventV2;

  if (
    event.signerUserId !== input.userId ||
    event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new DocumentV2MutationError("Forbidden", 403);
  }

  if (
    input.expectedEventType !== undefined &&
    event.eventType !== input.expectedEventType
  ) {
    throw new DocumentV2MutationError("Unexpected document event type", 400);
  }

  if (
    input.expectedDocumentId !== undefined &&
    event.objectId !== input.expectedDocumentId
  ) {
    throw new DocumentV2MutationError("Document id mismatch", 400);
  }

  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as KeyingV2CanonicalJson,
    event,
    signerPublicKey: await loadSignerPublicKey(input.executor, input),
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

function toVerifiedContainerManifest(
  bundle: ContainerV2ManifestBundle,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function toVerifiedDocumentManifest(
  bundle: DocumentV2ManifestBundle,
): VerifiedDocumentLinkSetManifest {
  return bundle as unknown as VerifiedDocumentLinkSetManifest;
}

async function assertContainerManifestBundleConsistent(
  bundle: ContainerV2ManifestBundle,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const verified = toVerifiedContainerManifest(bundle);
  const derivedManifest = await deriveContainerAccessManifest(
    verified.state as ContainerAccessManifestStateV2,
  );
  const derivedManifestHash = await computeAccessManifestHash(derivedManifest);
  const suppliedManifestHash = await computeAccessManifestHash(
    verified.manifest,
  );

  if (
    verified.manifestHash !== derivedManifestHash ||
    verified.manifestHash !== suppliedManifestHash ||
    !canonicalJsonEquals(derivedManifest, verified.manifest)
  ) {
    throw new DocumentV2MutationError(
      `${label} manifest bundle is not self-consistent`,
      409,
    );
  }

  return verified;
}

async function assertDocumentManifestBundleConsistent(
  bundle: DocumentV2ManifestBundle,
  label: string,
): Promise<VerifiedDocumentLinkSetManifest> {
  const verified = toVerifiedDocumentManifest(bundle);
  const derivedManifest = await deriveDocumentLinkSetManifest(verified.state);
  const derivedManifestHash = await computeAccessManifestHash(derivedManifest);
  const suppliedManifestHash = await computeAccessManifestHash(
    verified.manifest,
  );

  if (
    verified.manifestHash !== derivedManifestHash ||
    verified.manifestHash !== suppliedManifestHash ||
    !canonicalJsonEquals(derivedManifest, verified.manifest)
  ) {
    throw new DocumentV2MutationError(
      `${label} manifest bundle is not self-consistent`,
      409,
    );
  }

  return verified;
}

async function assertCurrentContainerPath(
  executor: DatabaseExecutor,
  bundles: readonly Record<string, unknown>[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[] | undefined> {
  if (bundles === undefined) {
    return undefined;
  }

  const path: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of bundles.entries()) {
    const manifest = await assertContainerManifestBundleConsistent(
      bundle as unknown as ContainerV2ManifestBundle,
      `${label}[${index}]`,
    );
    const head = await getCurrentAccessManifestHead(
      "container",
      manifest.state.containerId,
      executor,
    );
    if (!head) {
      throw new DocumentV2MutationError(`${label}[${index}] head missing`, 404);
    }
    if (head.manifestHash !== manifest.manifestHash) {
      throw new DocumentV2MutationError(`${label}[${index}] is stale`, 409);
    }
    path.push(manifest);
  }

  return path;
}

async function assertCurrentContainerPathGroups(
  executor: DatabaseExecutor,
  groups: readonly (readonly Record<string, unknown>[])[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[][] | undefined> {
  if (groups === undefined) {
    return undefined;
  }

  const verifiedGroups: VerifiedContainerAccessManifest[][] = [];
  for (const [index, group] of groups.entries()) {
    verifiedGroups.push(
      (await assertCurrentContainerPath(
        executor,
        group,
        `${label}[${index}]`,
      )) ?? [],
    );
  }

  return verifiedGroups;
}

function principalPoliciesFromRequest(
  policies: readonly Record<string, unknown>[] | undefined,
): VerifiedPrincipalPolicy[] {
  return (policies ?? []) as unknown as VerifiedPrincipalPolicy[];
}

async function verifyDocumentManifestFromRequest(input: {
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseExecutor;
  readonly request: DocumentV2CreateRequest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const [targetContainerPath, authorizingContainerPaths] = await Promise.all([
    assertCurrentContainerPath(
      input.executor,
      input.request.targetContainerPath,
      "targetContainerPath",
    ),
    assertCurrentContainerPathGroups(
      input.executor,
      input.request.authorizingContainerPaths,
      "authorizingContainerPaths",
    ),
  ]);
  const result = await verifyDocumentLinkSetManifest({
    event: input.event,
    expectedManifestHash: input.request.expectedManifestHash,
    manifest: input.request.manifest as unknown as AccessManifestV2,
    previousManifest:
      input.request.previousManifest === undefined ||
      input.request.previousManifest === null
        ? null
        : await assertDocumentManifestBundleConsistent(
            input.request.previousManifest,
            "previousManifest",
          ),
    principalPolicies: principalPoliciesFromRequest(
      input.request.principalPolicies,
    ),
    ...(targetContainerPath !== undefined ? { targetContainerPath } : {}),
    ...(authorizingContainerPaths !== undefined
      ? { authorizingContainerPaths }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function toStoredTargetEnvelope(
  target: DocumentV2ContentKeyTargetEnvelope,
): StoredDocumentContentKeyTargetEnvelope {
  return {
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
    wrappedKey: target.wrappedKey,
    wrappingMetadata: target.wrappingMetadata as KeyingV2CanonicalJson,
  };
}

function toStoredContentKeyBundleInput(
  documentId: string,
  bundle: DocumentV2ContentKeyBundleRequest,
) {
  return {
    documentId,
    contentKeyEpoch: bundle.contentKeyEpoch,
    linkSetManifestHash: bundle.linkSetManifestHash,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map(toStoredTargetEnvelope),
  };
}

function assertSyncContentKeyBundleMatchesRequest(
  request: DocumentV2SyncRequest,
): void {
  if (!request.contentKeyBundle) {
    return;
  }

  if (
    request.contentKeyBundle.contentKeyEpoch !== request.contentKeyEpoch ||
    request.contentKeyBundle.linkSetManifestHash !==
      request.expectedLinkSetManifestHash ||
    request.contentKeyBundle.targetHash !== request.expectedTargetHash
  ) {
    throw new DocumentV2MutationError(
      "Content key bundle does not match sync request",
      400,
    );
  }
}

function toContentKeyBundleResponse(
  bundle: Awaited<ReturnType<typeof storeDocumentContentKeyBundle>>,
): DocumentV2ContentKeyBundleResponse {
  return {
    documentId: bundle.documentId,
    contentKeyEpoch: bundle.contentKeyEpoch,
    linkSetManifestHash: bundle.linkSetManifestHash,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map((target) => ({
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: target.wrappingMetadata as Record<string, unknown>,
    })),
  };
}

function toDocumentKekTargetsResponse(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
): DocumentV2KekTargetsResponse {
  return {
    documentId: targets.documentId,
    linkSetManifestHash: targets.linkSetManifestHash,
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    documentKeyTargetHash: targets.documentKeyTargetHash,
  };
}

async function insertDocumentAndLinks(input: {
  readonly createdByFingerprint: string;
  readonly executor: DatabaseExecutor;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}) {
  const [inserted] = await input.executor
    .insert(documents)
    .values({
      id: input.manifest.state.documentId,
      createdByFingerprint: input.createdByFingerprint,
    })
    .returning();
  if (!inserted) {
    throw new DocumentV2MutationError("Failed to create document", 409);
  }

  await input.executor.insert(documentContainerLinks).values(
    input.manifest.state.linkedContainerIds.map((containerId) => ({
      documentId: input.manifest.state.documentId,
      containerId,
    })),
  );

  return inserted;
}

async function assertCreateCanAdvanceDocumentHead(
  executor: DatabaseExecutor,
  documentId: string,
): Promise<void> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (head) {
    throw new DocumentV2MutationError("Document manifest already exists", 409);
  }
}

export async function createDocumentV2(
  runtime: ApiServiceRuntime,
  input: CreateDocumentV2Input,
): Promise<DocumentV2CreateResponse> {
  try {
    return await runtime.db.transaction(async (tx) => {
      const event = await verifyDocumentEvent({
        body: input.request.body,
        event: input.request.event,
        expectedEventType: "document.link",
        executor: tx,
        fingerprint: input.fingerprint,
        userId: input.userId,
      });
      const manifest = await verifyDocumentManifestFromRequest({
        event,
        executor: tx,
        request: input.request,
      });

      if (
        manifest.state.epoch !== 1 ||
        manifest.state.previousManifestHash !== null
      ) {
        throw new DocumentV2MutationError(
          "Document create requires an initial link-set manifest",
          400,
        );
      }

      await assertCreateCanAdvanceDocumentHead(tx, manifest.state.documentId);
      const document = await insertDocumentAndLinks({
        createdByFingerprint: input.fingerprint,
        executor: tx,
        manifest,
      });
      await storeVerifiedAccessManifest({ verifiedManifest: manifest }, tx);

      const contentKeyBundle = await storeDocumentContentKeyBundle(
        toStoredContentKeyBundleInput(
          manifest.state.documentId,
          input.request.contentKeyBundle,
        ),
        tx,
      );
      const currentTargets = await resolveCurrentDocumentKekTargets(
        manifest.state.documentId,
        tx,
      );

      return {
        id: document.id,
        createdAt: document.createdAt.toISOString(),
        accessManifest: {
          event: manifest.event as unknown as Record<string, unknown>,
          manifest: manifest.manifest as unknown as Record<string, unknown>,
          manifestHash: manifest.manifestHash,
          state: manifest.state as unknown as Record<string, unknown>,
        },
        contentKeyBundle: toContentKeyBundleResponse(contentKeyBundle),
        documentKekTargets: toDocumentKekTargetsResponse(currentTargets),
      };
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

async function ensureWritableDocument(input: {
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}) {
  const [document] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    throw new DocumentV2MutationError("Document not found", 404);
  }

  const access = await resolveDocumentAccessState(
    input.documentId,
    input.executor,
  );
  if (!access) {
    throw new DocumentV2MutationError("Document access state not found", 409);
  }
  if (!canReadDocumentAccess(access, input.userId)) {
    throw new DocumentV2MutationError("Forbidden", 403);
  }
  if (!canWriteDocumentAccess(access, input.userId)) {
    throw new DocumentV2MutationError("Forbidden", 403);
  }

  return access;
}

async function verifyOutgoingWriteHeader(input: {
  readonly documentId: string;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly requestContentKeyEpoch: number;
  readonly signingPublicKey: Uint8Array;
  readonly update: DocumentV2OutgoingUpdate;
  readonly userId: string;
}): Promise<VerifiedWriteHeader> {
  const header = input.update.writeHeader as unknown as WriteHeaderV2;
  if (
    header.writerUserId !== input.userId ||
    header.contentKeyEpoch !== input.requestContentKeyEpoch
  ) {
    throw new DocumentV2MutationError(
      "Write header does not match request",
      400,
    );
  }

  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: input.expectedLinkSetManifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: input.documentId,
    },
    expectedTargetHash: input.expectedTargetHash,
    header,
    writerPublicKey: input.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

async function assertRetryWriteHeaderMatches(input: {
  readonly expectedHeaderHash: string;
  readonly update: DocumentV2OutgoingUpdate;
}): Promise<void> {
  const headerHash = await computeWriteHeaderHash(
    input.update.writeHeader as unknown as WriteHeaderV2,
  );
  if (headerHash !== input.expectedHeaderHash) {
    throw new DocumentV2MutationError("Document write header conflict", 409);
  }
}

async function appendDocumentV2Updates(input: {
  readonly accessEpoch: number;
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly fingerprint: string;
  readonly request: DocumentV2SyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}): Promise<string[]> {
  if (input.request.outgoingUpdates.length === 0) {
    return [];
  }

  const updateIds = uniqueSortedStrings(
    input.request.outgoingUpdates.map((update) => update.id),
  );
  const existingRows = await input.executor
    .select({ documentId: documentUpdates.documentId, id: documentUpdates.id })
    .from(documentUpdates)
    .where(inArray(documentUpdates.id, updateIds));
  for (const row of existingRows) {
    if (row.documentId !== input.documentId) {
      throw new DocumentV2MutationError("Document update id conflict", 409);
    }
  }
  const acceptedUpdateIds = new Set(existingRows.map((row) => row.id));
  const acceptedHeaderHashes = new Map(
    (
      await listDocumentContentWriteHeaders(
        [...acceptedUpdateIds],
        input.executor,
      )
    ).entries(),
  );
  const newUpdates: DocumentV2OutgoingUpdate[] = [];

  for (const update of input.request.outgoingUpdates) {
    const acceptedHeaderHash = acceptedHeaderHashes.get(update.id)?.headerHash;
    if (acceptedUpdateIds.has(update.id)) {
      if (!acceptedHeaderHash) {
        throw new DocumentV2MutationError(
          "Document write header conflict",
          409,
        );
      }
      await assertRetryWriteHeaderMatches({
        expectedHeaderHash: acceptedHeaderHash,
        update,
      });
      continue;
    }

    const verifiedHeader = await verifyOutgoingWriteHeader({
      documentId: input.documentId,
      expectedLinkSetManifestHash: input.request.expectedLinkSetManifestHash,
      expectedTargetHash: input.request.expectedTargetHash,
      requestContentKeyEpoch: input.request.contentKeyEpoch,
      signingPublicKey: input.signingPublicKey,
      update,
      userId: input.userId,
    });

    await storeDocumentContentWriteHeader(
      {
        documentId: input.documentId,
        header: verifiedHeader.header,
        headerHash: verifiedHeader.headerHash,
        updateId: update.id,
      },
      input.executor,
    );

    acceptedUpdateIds.add(update.id);
    acceptedHeaderHashes.set(update.id, {
      header: verifiedHeader.header,
      headerHash: verifiedHeader.headerHash,
    });
    newUpdates.push(update);
  }

  if (newUpdates.length > 0) {
    const insertedRows = await input.executor
      .insert(documentUpdates)
      .values(
        newUpdates.map((update) => ({
          id: update.id,
          documentId: input.documentId,
          accessEpoch: input.accessEpoch,
          authorFingerprint: input.fingerprint,
          encryptedData: update.encryptedData,
          partialStartVersionVector: update.partialStartVersionVector,
          partialEndVersionVector: update.partialEndVersionVector,
        })),
      )
      .returning({ id: documentUpdates.id });
    const insertedUpdateIds = new Set(insertedRows.map((row) => row.id));
    await insertDocumentUpdateSpans(input.executor, {
      documentId: input.documentId,
      updates: newUpdates.filter((update) => insertedUpdateIds.has(update.id)),
    });
  }

  return input.request.outgoingUpdates
    .filter((update) => acceptedUpdateIds.has(update.id))
    .map((update) => update.id);
}

async function listMissingUpdates(input: {
  readonly documentId: string;
  readonly localVersionVector: string | null;
  readonly minLsn?: string | undefined;
  readonly runtime: ApiServiceRuntime;
}) {
  const store = createDocumentSyncStore(input.runtime);
  return store.listMissingDocumentUpdates({
    documentId: input.documentId,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
  });
}

function toSyncUpdate(
  update: Awaited<ReturnType<typeof listMissingUpdates>>[number],
  writeHeader: { readonly header: WriteHeaderV2; readonly headerHash: string },
) {
  return {
    accessEpoch: update.accessEpoch,
    id: update.id,
    documentId: update.documentId,
    authorFingerprint: update.authorFingerprint,
    encryptedData: update.encryptedData,
    partialStartVersionVector: update.partialStartVersionVector,
    partialEndVersionVector: update.partialEndVersionVector,
    createdAt: update.createdAt.toISOString(),
    writeHeader: writeHeader.header as unknown as Record<string, unknown>,
    writeHeaderHash: writeHeader.headerHash,
  };
}

async function attachWriteHeadersToUpdates(input: {
  readonly runtime: ApiServiceRuntime;
  readonly updates: Awaited<ReturnType<typeof listMissingUpdates>>;
}) {
  const writeHeadersByUpdateId = await listDocumentContentWriteHeaders(
    input.updates.map((update) => update.id),
    input.runtime.db,
  );

  return input.updates.map((update) => {
    const writeHeader = writeHeadersByUpdateId.get(update.id);
    if (!writeHeader) {
      throw new DocumentV2MutationError("Document write header missing", 409);
    }

    return toSyncUpdate(update, writeHeader);
  });
}

function getMissingUpdateEpochs(
  updates: ReturnType<typeof toSyncUpdate>[],
  currentAccessEpoch: number,
): ("prior_epoch" | "current_epoch")[] {
  const missingUpdateEpochs: ("prior_epoch" | "current_epoch")[] = [];

  if (updates.some((update) => update.accessEpoch < currentAccessEpoch)) {
    missingUpdateEpochs.push("prior_epoch");
  }
  if (updates.some((update) => update.accessEpoch === currentAccessEpoch)) {
    missingUpdateEpochs.push("current_epoch");
  }

  return missingUpdateEpochs;
}

export async function syncDocumentV2(
  runtime: ApiServiceRuntime,
  input: SyncDocumentV2Input,
): Promise<DocumentV2SyncResponse> {
  try {
    const signingPublicKey = await loadSignerPublicKey(runtime.db, input);
    const transactionResult = await runtime.db.transaction(async (tx) => {
      const access = await ensureWritableDocument({
        documentId: input.documentId,
        executor: tx,
        userId: input.userId,
      });
      assertSyncContentKeyBundleMatchesRequest(input.request);
      const contentKeyBundle = input.request.contentKeyBundle
        ? await storeDocumentContentKeyBundle(
            toStoredContentKeyBundleInput(
              input.documentId,
              input.request.contentKeyBundle,
            ),
            tx,
          )
        : await requireCurrentDocumentContentKeyBundle({
            documentId: input.documentId,
            contentKeyEpoch: input.request.contentKeyEpoch,
            expectedLinkSetManifestHash:
              input.request.expectedLinkSetManifestHash,
            expectedTargetHash: input.request.expectedTargetHash,
            executor: tx,
          });
      const acceptedOutgoingUpdateIds = await appendDocumentV2Updates({
        accessEpoch: access.currentAccessEpoch,
        documentId: input.documentId,
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request,
        signingPublicKey,
        userId: input.userId,
      });
      const currentTargets = await resolveCurrentDocumentKekTargets(
        input.documentId,
        tx,
      );

      return {
        accessEpoch: access.currentAccessEpoch,
        acceptedOutgoingUpdateIds,
        contentKeyBundle,
        currentTargets,
      };
    });
    const missingUpdateRecords = await listMissingUpdates({
      documentId: input.documentId,
      localVersionVector: input.request.localVersionVector,
      minLsn: input.request.minLsn,
      runtime,
    });
    const missingUpdates = await attachWriteHeadersToUpdates({
      runtime,
      updates: missingUpdateRecords,
    });

    return {
      acceptedOutgoingUpdateIds: transactionResult.acceptedOutgoingUpdateIds,
      commitLsn: await readCurrentCommitLsn(runtime.db),
      contentKeyBundle: toContentKeyBundleResponse(
        transactionResult.contentKeyBundle,
      ),
      documentId: input.documentId,
      documentKekTargets: toDocumentKekTargetsResponse(
        transactionResult.currentTargets,
      ),
      missingUpdateEpochs: getMissingUpdateEpochs(
        missingUpdates,
        transactionResult.accessEpoch,
      ),
      updates: missingUpdates,
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
