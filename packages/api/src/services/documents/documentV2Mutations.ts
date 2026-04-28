import type {
  AccessEventV2,
  AccessManifestV2,
  ContainerAccessManifestStateV2,
  KeyingV2CanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentKekTargets,
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
  DocumentContentKeyBundleError,
  listDocumentContentWriteHeaders,
  requireCurrentDocumentContentKeyBundle,
  type DocumentContentKeyTargetEnvelope as StoredDocumentContentKeyTargetEnvelope,
  storeDocumentContentKeyBundle,
  storeDocumentContentWriteHeader,
} from "../../access/documentContentKeyStore";
import {
  DocumentKekTargetError,
  resolveCurrentDocumentKekTargets,
} from "../../access/documentKekTargets";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  documentContainerLinks,
  documents,
  documentUpdates,
  users,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";
import {
  ContainerV2WriterProjectionError,
  resolveContainerV2WriterProjection,
} from "../containers/v2WriterProjection";
import type { ApiServiceRuntime } from "../runtime";
import { readCurrentCommitLsn } from "./commitLsn";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";
import {
  DocumentUpdateReadError,
  listMissingDocumentUpdates,
} from "./documentUpdateStore";
import {
  loadPrincipalPoliciesForContainerPaths,
  PrincipalPolicyProjectionError,
} from "./principalPolicyProjection";

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

interface AppendDocumentV2UpdatesInput {
  readonly accessEpoch: number;
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly fingerprint: string;
  readonly organizationId: string;
  readonly request: DocumentV2SyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
}

interface DocumentWriteAuthorizationProof {
  readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly documentKekTargets: VerifiedDocumentKekTargets;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
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

  if (error instanceof DocumentUpdateReadError) {
    return new DocumentV2MutationError(error.message, error.status);
  }

  if (error instanceof DocumentKekTargetError) {
    return new DocumentV2MutationError(error.message, error.status);
  }

  if (error instanceof PrincipalPolicyProjectionError) {
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

export async function loadSignerPublicKey(
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

export async function assertDocumentManifestBundleConsistent(
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

export async function assertCurrentContainerPathGroups(
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
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    [
      ...(targetContainerPath ? [targetContainerPath] : []),
      ...(authorizingContainerPaths ?? []),
    ],
  );
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
    principalPolicies,
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

async function verifySyncWriteAuthorizationProof(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly request: DocumentV2SyncRequest;
}): Promise<DocumentWriteAuthorizationProof | null> {
  if (input.request.outgoingUpdates.length === 0) {
    return null;
  }
  if (!input.request.documentManifest) {
    throw new DocumentV2MutationError(
      "Document write authorization proof is required",
      400,
    );
  }
  if (!input.request.authorizingContainerPaths) {
    throw new DocumentV2MutationError(
      "Document write authorization paths are required",
      400,
    );
  }

  const documentManifest = await assertDocumentManifestBundleConsistent(
    input.request.documentManifest,
    "documentManifest",
  );
  if (
    documentManifest.state.documentId !== input.documentId ||
    documentManifest.manifestHash !== input.request.expectedLinkSetManifestHash
  ) {
    throw new DocumentV2MutationError(
      "Document write authorization manifest does not match sync request",
      409,
    );
  }

  const authorizingContainerPaths = await assertCurrentContainerPathGroups(
    input.executor,
    input.request.authorizingContainerPaths,
    "authorizingContainerPaths",
  );
  if (!authorizingContainerPaths || authorizingContainerPaths.length === 0) {
    throw new DocumentV2MutationError(
      "Document write authorization paths are required",
      400,
    );
  }
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    authorizingContainerPaths,
  );

  return {
    authorizingContainerPaths,
    documentKekTargets:
      input.currentTargets as unknown as VerifiedDocumentKekTargets,
    documentManifest,
    principalPolicies,
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
    return await runtime.db.transaction((tx) =>
      createDocumentV2WithExecutor({
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request,
        userId: input.userId,
      }),
    );
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

export async function createDocumentV2WithExecutor(input: {
  readonly executor: DatabaseExecutor;
  readonly fingerprint: string;
  readonly request: DocumentV2CreateRequest;
  readonly userId: string;
}): Promise<DocumentV2CreateResponse> {
  try {
    const event = await verifyDocumentEvent({
      body: input.request.body,
      event: input.request.event,
      expectedEventType: "document.link",
      executor: input.executor,
      fingerprint: input.fingerprint,
      userId: input.userId,
    });
    const manifest = await verifyDocumentManifestFromRequest({
      event,
      executor: input.executor,
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

    await assertCreateCanAdvanceDocumentHead(
      input.executor,
      manifest.state.documentId,
    );
    const document = await insertDocumentAndLinks({
      createdByFingerprint: input.fingerprint,
      executor: input.executor,
      manifest,
    });
    await storeVerifiedAccessManifest(
      { verifiedManifest: manifest },
      input.executor,
    );

    const contentKeyBundle = await storeDocumentContentKeyBundle(
      toStoredContentKeyBundleInput(
        manifest.state.documentId,
        input.request.contentKeyBundle,
      ),
      input.executor,
    );
    const currentTargets = await resolveCurrentDocumentKekTargets(
      manifest.state.documentId,
      input.executor,
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
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

async function ensureDocumentExists(input: {
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
}): Promise<void> {
  const [document] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    throw new DocumentV2MutationError("Document not found", 404);
  }
}

async function ensureWritableDocumentV2(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<void> {
  for (const containerId of new Set(
    input.currentTargets.targets.map((target) => target.containerId),
  )) {
    try {
      await resolveContainerV2WriterProjection({
        containerId,
        executor: input.executor,
        userId: input.userId,
      });
      return;
    } catch (error) {
      if (
        error instanceof ContainerV2WriterProjectionError &&
        error.status === 403
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new DocumentV2MutationError("Forbidden", 403);
}

async function verifyOutgoingWriteHeader(input: {
  readonly documentId: string;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly organizationId: string;
  readonly requestContentKeyEpoch: number;
  readonly signingPublicKey: Uint8Array;
  readonly update: DocumentV2OutgoingUpdate;
  readonly userId: string;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
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
  if (!input.writeAuthorization) {
    throw new DocumentV2MutationError(
      "Document write authorization proof is required",
      400,
    );
  }

  const verified = await verifyWriteHeader({
    documentAuthorization: input.writeAuthorization,
    expectedAccessManifestHash: input.expectedLinkSetManifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: input.documentId,
      organizationId: input.organizationId,
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

function acceptedOutgoingUpdateIds(
  updates: readonly DocumentV2OutgoingUpdate[],
  acceptedUpdateIds: ReadonlySet<string>,
): string[] {
  return updates
    .filter((update) => acceptedUpdateIds.has(update.id))
    .map((update) => update.id);
}

async function insertNewDocumentV2Updates(input: {
  readonly accessEpoch: number;
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly fingerprint: string;
  readonly updates: readonly DocumentV2OutgoingUpdate[];
}): Promise<void> {
  if (input.updates.length === 0) {
    return;
  }

  const insertedRows = await input.executor
    .insert(documentUpdates)
    .values(
      input.updates.map((update) => ({
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
    updates: input.updates.filter((update) => insertedUpdateIds.has(update.id)),
  });
}

async function appendDocumentV2Updates(
  input: AppendDocumentV2UpdatesInput,
): Promise<string[]> {
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
      organizationId: input.organizationId,
      requestContentKeyEpoch: input.request.contentKeyEpoch,
      signingPublicKey: input.signingPublicKey,
      update,
      userId: input.userId,
      writeAuthorization: input.writeAuthorization,
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

  await insertNewDocumentV2Updates({
    accessEpoch: input.accessEpoch,
    documentId: input.documentId,
    executor: input.executor,
    fingerprint: input.fingerprint,
    updates: newUpdates,
  });

  return acceptedOutgoingUpdateIds(
    input.request.outgoingUpdates,
    acceptedUpdateIds,
  );
}

async function listMissingUpdates(input: {
  readonly documentId: string;
  readonly localVersionVector: string | null;
  readonly minLsn?: string | undefined;
  readonly runtime: ApiServiceRuntime;
}) {
  return listMissingDocumentUpdates(input.runtime.db, {
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

async function syncDocumentV2Transaction(input: {
  readonly documentId: string;
  readonly fingerprint: string;
  readonly request: DocumentV2SyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly tx: DatabaseExecutor;
  readonly userId: string;
}) {
  await ensureDocumentExists({
    documentId: input.documentId,
    executor: input.tx,
  });
  assertSyncContentKeyBundleMatchesRequest(input.request);
  const currentTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  await ensureWritableDocumentV2({
    currentTargets,
    executor: input.tx,
    userId: input.userId,
  });
  const writeAuthorization = await verifySyncWriteAuthorizationProof({
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
  const contentKeyBundle = input.request.contentKeyBundle
    ? await storeDocumentContentKeyBundle(
        toStoredContentKeyBundleInput(
          input.documentId,
          input.request.contentKeyBundle,
        ),
        input.tx,
      )
    : await requireCurrentDocumentContentKeyBundle({
        documentId: input.documentId,
        contentKeyEpoch: input.request.contentKeyEpoch,
        expectedLinkSetManifestHash: input.request.expectedLinkSetManifestHash,
        expectedTargetHash: input.request.expectedTargetHash,
        executor: input.tx,
      });
  const acceptedOutgoingUpdateIds = await appendDocumentV2Updates({
    accessEpoch: currentTargets.linkSetEpoch,
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
    accessEpoch: currentTargets.linkSetEpoch,
    acceptedOutgoingUpdateIds,
    contentKeyBundle,
    currentTargets,
  };
}

export async function syncDocumentV2(
  runtime: ApiServiceRuntime,
  input: SyncDocumentV2Input,
): Promise<DocumentV2SyncResponse> {
  try {
    const signingPublicKey = await loadSignerPublicKey(runtime.db, input);
    const transactionResult = await runtime.db.transaction((tx) =>
      syncDocumentV2Transaction({
        documentId: input.documentId,
        fingerprint: input.fingerprint,
        request: input.request,
        signingPublicKey,
        tx,
        userId: input.userId,
      }),
    );
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
