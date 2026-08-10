import {
  type AccessEvent,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  generateKemSeedAndKeyPair,
  signWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type {
  ContainerManifestRef,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { buildDocumentCreatePlan } from "../../src/data/documents/shared/events";
import { deriveDocumentCreateTargets } from "../../src/data/documents/shared/projection";
import type {
  DocumentCreateAuthor,
  DocumentCreatePlan,
} from "../../src/data/documents/shared/types";
import { buildMaterializedDocumentCreatePlan } from "../../src/workflows/documents/create";
import type { buildDocumentSyncPlan } from "../../src/workflows/documents/syncPlanIdentity";
import {
  createAuthor,
  createProjection,
  fixtureHash,
} from "./documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "./trustedUserIdentity";

export function createResponse(
  plan: DocumentCreatePlan,
): DocumentCreateResponse {
  return {
    id: plan.documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    accessManifest: {
      event: {
        event: plan.event as unknown as Record<string, unknown>,
        body: plan.body as unknown as Record<string, unknown>,
        eventHash: plan.eventHash,
      },
      manifest: plan.manifest as unknown as Record<string, unknown>,
      manifestHash: plan.manifestHash,
      state: plan.state as unknown as Record<string, unknown>,
    },
    contentKeyBundle: {
      documentId: plan.documentId,
      contentKeyEpoch: plan.request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: plan.request.contentKeyBundle.linkSetManifestHash,
      targetHash: plan.request.contentKeyBundle.targetHash,
      targets: plan.request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId: plan.documentId,
      linkSetManifestHash: plan.manifestHash,
      linkedContainerManifestHashes: plan.targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: plan.targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets: plan.targets.map((target) => ({
        ...target,
      })),
      documentKeyTargetHash: plan.targetHash,
    },
  };
}

export async function createResponseFromRequest(
  request: DocumentCreateRequest,
): Promise<DocumentCreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const eventHash = await computeAccessEventHash(
    request.event as unknown as AccessEvent,
  );
  const linkedContainerId = String(Reflect.get(body, "containerId"));
  const targets = request.contentKeyBundle.targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    id: documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    accessManifest: {
      event: {
        event: request.event,
        body,
        eventHash,
      },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 1,
        documentId,
        organizationId: String(Reflect.get(manifest, "organizationId")),
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: Reflect.get(manifest, "previousManifestHash"),
        eventHash,
        linkedContainerIds: [linkedContainerId],
      },
    },
    contentKeyBundle: {
      documentId,
      contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: request.contentKeyBundle.linkSetManifestHash,
      targetHash: request.contentKeyBundle.targetHash,
      targets: request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId,
      linkSetManifestHash: request.expectedManifestHash,
      linkedContainerManifestHashes: targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets,
      documentKeyTargetHash: request.contentKeyBundle.targetHash,
    },
  };
}

export async function createLinkSetResponseFromRequest(
  documentId: string,
  request: DocumentLinkSetMutationRequest,
): Promise<DocumentLinkSetMutationResponse> {
  const body = request.body as Record<string, unknown>;
  const manifest = request.manifest as Record<string, unknown>;
  const event = request.event as unknown as AccessEvent;
  const eventHash = await computeAccessEventHash(event);
  // The server no longer receives the previous manifest bundle; the new
  // link-set is exactly the content-key target set, and the prior head hash is
  // carried by the signed event.
  const linkedContainerIds = [
    ...new Set(
      request.contentKeyBundle.targets.map((target) => target.containerId),
    ),
  ].sort();
  const targets = request.contentKeyBundle.targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    id: documentId,
    accessManifest: {
      event: {
        event: request.event,
        body,
        eventHash,
      },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 1,
        documentId,
        organizationId: String(Reflect.get(manifest, "organizationId")),
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: String(
          Reflect.get(request.event, "previousManifestHash"),
        ),
        eventHash,
        linkedContainerIds,
      },
    },
    contentKeyBundle: {
      documentId,
      contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: request.contentKeyBundle.linkSetManifestHash,
      targetHash: request.contentKeyBundle.targetHash,
      targets: request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId,
      linkSetManifestHash: request.expectedManifestHash,
      linkedContainerManifestHashes: targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets,
      documentKeyTargetHash: request.contentKeyBundle.targetHash,
    },
  };
}

export function getOnlyTarget(
  projection: ContainerWriterProjectionResponse,
): ReturnType<typeof deriveDocumentCreateTargets>[number] {
  const target = deriveDocumentCreateTargets(projection)[0];
  if (!target) {
    throw new Error("Expected test projection to derive a document target");
  }
  return target;
}

export async function createSyncFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const createPlan = await buildDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "event-sync",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetEnvelopes: [
      {
        ...target,
        wrappedKey: "wrapped-document-key",
        wrappingMetadata: {},
      },
    ],
  });

  return {
    author,
    createResponse: createResponse(createPlan),
    projection,
    signingPublicKey,
  };
}

export async function createMaterializedSyncFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "materialized-sync-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "550e8400-e29b-41d4-a716-446655440010",
    eventId: "event-materialized-sync",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    documentId: response.id,
    documentManifest: response.accessManifest,
    documentManifestHistory: [],
    documentManifestContainerPaths: [[...projection.path]],
    documentContainerManifestHistory: [
      ...projection.path,
      ...projection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ],
    documentKekTargets: response.documentKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    authorizingContainerPaths: [projection],
  };

  return {
    author,
    contentKey,
    createResponse: response,
    projection,
    publicKey: keyPair.publicKey,
    resolveProjectionUserKey,
    secretKey: keyPair.secretKey,
    signingPublicKey,
    writerProjection,
  };
}

export async function createPreparedUpdate(
  overrides: {
    checkpointKind?: "rotate_baseline" | undefined;
    checkpointPayloadKind?: "full_history_snapshot" | undefined;
    ciphertextHash?: string | undefined;
    contentRecordId?: string | undefined;
    encryptedData?: string | undefined;
    id?: string | undefined;
    metadataHash?: string | undefined;
    partialEndVersionVector?: string | undefined;
    partialStartVersionVector?: string | undefined;
    plaintextHash?: string | undefined;
    signedAt?: string | undefined;
    sourceVersionVector?: string | undefined;
  } = {},
) {
  const partialEndVersionVector =
    overrides.partialEndVersionVector ?? '{"actor":1}';
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: overrides.encryptedData ?? "encrypted-update",
    partialStartVersionVector: overrides.partialStartVersionVector ?? "{}",
    partialEndVersionVector,
    plaintextHash:
      overrides.plaintextHash ?? (await fixtureHash("plaintext-update")),
    metadataHash: overrides.metadataHash ?? (await fixtureHash("metadata")),
    ciphertextHash:
      overrides.ciphertextHash ?? (await fixtureHash("ciphertext")),
    ...(overrides.checkpointKind === undefined
      ? {}
      : { checkpointKind: overrides.checkpointKind }),
    ...(overrides.checkpointKind === undefined
      ? {}
      : {
          checkpointPayloadKind:
            overrides.checkpointPayloadKind ?? "full_history_snapshot",
        }),
    ...(overrides.contentRecordId === undefined
      ? {}
      : { contentRecordId: overrides.contentRecordId }),
    ...(overrides.signedAt === undefined
      ? {}
      : { signedAt: overrides.signedAt }),
    ...(overrides.checkpointKind === undefined &&
    overrides.sourceVersionVector === undefined
      ? {}
      : {
          sourceVersionVector:
            overrides.sourceVersionVector ?? partialEndVersionVector,
        }),
  };
}

const FIXTURE_LORO_UPDATE_DATA =
  "bG9ybwAAAAAAAAAAAAAAACbFJ0EABE8AEwATARABk9Mh/fGnS/0BAQAAAAAABQEAAAEABgEEAQIAAAUEdGV4dAAOAQQCAQACAQACAQUCARMAFBNtYXRlcmlhbGl6ZWQgdXBkYXRl";
const FIXTURE_LORO_UPDATE_START_VERSION_VECTOR = "AZOnh+mf/uml/QEA";
const FIXTURE_LORO_UPDATE_END_VERSION_VECTOR = "AZOnh+mf/uml/QEm";

export function createPendingUpdateRecord(
  overrides: {
    id?: string | undefined;
    partialEndVersionVector?: string | undefined;
    partialStartVersionVector?: string | undefined;
    sourceVersionVector?: string | null | undefined;
    updateData?: string | undefined;
  } = {},
) {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440444",
    updateData: overrides.updateData ?? FIXTURE_LORO_UPDATE_DATA,
    partialStartVersionVector:
      overrides.partialStartVersionVector ??
      FIXTURE_LORO_UPDATE_START_VERSION_VECTOR,
    partialEndVersionVector:
      overrides.partialEndVersionVector ??
      FIXTURE_LORO_UPDATE_END_VERSION_VECTOR,
    sourceVersionVector: overrides.sourceVersionVector ?? null,
  };
}

export function projectionPathRefs(
  projection: ContainerWriterProjectionResponse,
): ContainerManifestRef[] {
  return projection.path.map((bundle) => ({
    containerId: String(
      (bundle.state as { containerId?: unknown }).containerId,
    ),
    manifestHash: bundle.manifestHash,
  }));
}

export async function createSyncResponse(
  plan: Awaited<ReturnType<typeof buildDocumentSyncPlan>>,
  overrides: Partial<DocumentSyncResponse> = {},
): Promise<DocumentSyncResponse> {
  const updates = await Promise.all(
    plan.request.outgoingUpdates.map(async (update) => {
      const writeHeader = update.writeHeader as unknown as WriteHeader;
      return {
        accessEpoch: 1,
        ...(update.checkpointKind === undefined
          ? {}
          : { checkpointKind: update.checkpointKind }),
        ...(update.checkpointPayloadKind === undefined
          ? {}
          : { checkpointPayloadKind: update.checkpointPayloadKind }),
        id: update.id,
        documentId: plan.documentId,
        authorFingerprint: writeHeader.writerKeyFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        plaintextHash: update.plaintextHash,
        ...(update.sourceVersionVector === undefined
          ? {}
          : { sourceVersionVector: update.sourceVersionVector }),
        createdAt: "2026-04-27T00:00:00.000Z",
        writeHeader: update.writeHeader,
      };
    }),
  );

  return {
    acceptedOutgoingUpdateIds: plan.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: "0/16B6C50",
    contentKeyBundle: plan.sourceContentKeyBundle,
    contentKeyBundles: [plan.sourceContentKeyBundle],
    documentId: plan.documentId,
    documentKekTargets: plan.documentKekTargets,
    updates,
    ...overrides,
  };
}

export async function createSignedSyncResponseUpdate(input: {
  accessManifestHash: string;
  author: DocumentCreateAuthor;
  contentKeyEpoch?: number | undefined;
  id?: string | undefined;
  plan: Awaited<ReturnType<typeof buildDocumentSyncPlan>>;
  targetHash: string;
}): Promise<DocumentSyncResponse["updates"][number]> {
  const id = input.id ?? "550e8400-e29b-41d4-a716-446655440555";
  const encryptedData = "historical encrypted update";
  const partialStartVersionVector = "{}";
  const partialEndVersionVector = '{"actor":3}';
  const plaintextHash = await fixtureHash(`plaintext:${id}`);
  const contentKeyEpoch = input.contentKeyEpoch ?? input.plan.contentKeyEpoch;
  const nonceDomain = {
    version: 1 as const,
    organizationId: input.plan.organizationId,
    objectKind: "document" as const,
    objectId: input.plan.documentId,
    contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: id,
  };
  const writeHeader = await signWriteHeader(
    {
      ...nonceDomain,
      accessManifestHash: input.accessManifestHash,
      targetHash: input.targetHash,
      nonceDomainHash: await computeContentRecordNonceDomainHash(nonceDomain),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        documentId: input.plan.documentId,
        partialEndVersionVector,
        partialStartVersionVector,
        plaintextHash,
        updateId: id,
      }),
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
      writerUserId: input.author.signerUserId,
      writerDeviceId: input.author.signerDeviceId,
      writerKeyFingerprint: input.author.signerKeyFingerprint,
      signedAt: "2026-04-27T00:00:00.000Z",
    },
    input.author.signerPrivateKey,
  );

  return {
    accessEpoch: 1,
    id,
    documentId: input.plan.documentId,
    authorFingerprint: input.author.signerKeyFingerprint,
    encryptedData,
    partialStartVersionVector,
    partialEndVersionVector,
    plaintextHash,
    createdAt: "2026-04-27T00:00:00.000Z",
    writeHeader: writeHeader as unknown as Record<string, unknown>,
  };
}
