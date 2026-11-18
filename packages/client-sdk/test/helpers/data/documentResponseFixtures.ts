import {
  type AccessEvent,
  computeAccessEventHash,
  computeAccessManifestHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  deriveDocumentLinkSetManifest,
  type WriteHeader,
} from "@tearleads/crypto";
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
} from "@tearleads/validators/response";
import { buildDocumentCreatePlan } from "../../../src/data/documents/shared/events";
import { deriveDocumentCreateTargets } from "../../../src/data/documents/shared/projection";
import { targetEnvelopeReference } from "../../../src/data/documents/shared/readers";
import type { AcknowledgedDocumentMutation } from "../../../src/data/documents/shared/responses";
import type { DocumentCreatePlan } from "../../../src/data/documents/shared/types";
import type { buildDocumentSyncPlan } from "../../../src/workflows/documents/syncPlan/syncPlanIdentity";
import {
  createAuthor,
  createProjection,
  fixtureHash,
} from "./documentFixturePrimitives";

/**
 * A create or link-set acknowledgement together with the material a client
 * rebuilds from its plan, so fixtures can serve the response and seed the
 * projections that follow it.
 */
export type DocumentCreateFixture = DocumentCreateResponse &
  AcknowledgedDocumentMutation;
export type DocumentLinkSetFixture = DocumentLinkSetMutationResponse &
  AcknowledgedDocumentMutation;

/**
 * Fixture acknowledgements name no real bundle digest, so their authored
 * bundles are not cached; tests of that seeding compute the digest.
 */
const UNMATCHED_BUNDLE_DIGEST = "b".repeat(64);

export function createResponse(
  plan: DocumentCreatePlan,
): DocumentCreateFixture {
  return {
    bundleDigest: UNMATCHED_BUNDLE_DIGEST,
    id: plan.documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    contentKeyEpoch: plan.request.contentKeyBundle.contentKeyEpoch,
    eventHash: plan.eventHash,
    manifestHash: plan.manifestHash,
    targetHash: plan.targetHash,
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
): Promise<DocumentCreateFixture> {
  const body = request.body as Record<string, unknown>;
  const event = request.event as unknown as AccessEvent;
  const documentId = event.objectId;
  const eventHash = await computeAccessEventHash(event);
  const linkedContainerId = String(Reflect.get(body, "containerId"));
  const targets = request.contentKeyBundle.targets.map(targetEnvelopeReference);
  // The request carries only the hash; derive the initial manifest as the
  // API does.
  const state = {
    version: 1 as const,
    documentId,
    organizationId: event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [linkedContainerId],
  };
  const manifest = { ...(await deriveDocumentLinkSetManifest(state)) };

  return {
    bundleDigest: UNMATCHED_BUNDLE_DIGEST,
    id: documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
    eventHash,
    manifestHash: request.expectedManifestHash,
    targetHash: request.contentKeyBundle.targetHash,
    accessManifest: {
      event: {
        event: request.event,
        body,
        eventHash,
      },
      manifest,
      manifestHash: request.expectedManifestHash,
      state,
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
      targets: targets.map((target) => ({ ...target })),
      documentKeyTargetHash: request.contentKeyBundle.targetHash,
    },
  };
}

export async function createLinkSetResponseFromRequest(
  documentId: string,
  request: DocumentLinkSetMutationRequest,
): Promise<DocumentLinkSetFixture> {
  const body = request.body as Record<string, unknown>;
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
  const targets = request.contentKeyBundle.targets.map(targetEnvelopeReference);
  // The request carries only the manifest hash, as the server receives it;
  // the server derives the manifest, so this fixture does too.
  const { manifest, state } = await derivedLinkSetManifest({
    documentId,
    event,
    eventHash,
    expectedManifestHash: request.expectedManifestHash,
    linkedContainerIds,
  });

  return {
    bundleDigest: UNMATCHED_BUNDLE_DIGEST,
    id: documentId,
    contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
    eventHash,
    manifestHash: request.expectedManifestHash,
    targetHash: request.contentKeyBundle.targetHash,
    accessManifest: {
      event: {
        event: request.event,
        body,
        eventHash,
      },
      manifest,
      manifestHash: request.expectedManifestHash,
      state,
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
      targets: targets.map((target) => ({ ...target })),
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
        wrappedKey: "A".repeat(64),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: "A".repeat(16),
        },
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
        authorizationTargets: plan.sourceContentKeyBundle.targets.map(
          targetEnvelopeReference,
        ),
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
    commitLsnMode: "tracked",
    contentKeyBundles: [],
    documentId: plan.documentId,
    pullPage: { hasMore: false, nextCursor: null },
    updates,
    ...overrides,
  };
}

export { createSignedSyncResponseUpdate } from "./signedSyncResponseUpdate";

/**
 * The link-set manifest a request commits to by hash. The fixture does not
 * track the document's epoch, so it takes the epoch whose derived manifest
 * has the requested hash (the next head's epoch is small in every test).
 */
async function derivedLinkSetManifest(input: {
  readonly documentId: string;
  readonly event: AccessEvent;
  readonly eventHash: string;
  readonly expectedManifestHash: string;
  readonly linkedContainerIds: readonly string[];
}) {
  const stateAt = (epoch: number) => ({
    version: 1 as const,
    documentId: input.documentId,
    organizationId: input.event.organizationId,
    epoch,
    previousManifestHash: input.event.previousManifestHash,
    eventHash: input.eventHash,
    linkedContainerIds: [...input.linkedContainerIds],
  });
  for (let epoch = 1; epoch <= 64; epoch += 1) {
    const manifest = await deriveDocumentLinkSetManifest(stateAt(epoch));
    if (
      (await computeAccessManifestHash(manifest)) === input.expectedManifestHash
    )
      return { manifest: { ...manifest }, state: stateAt(epoch) };
  }
  throw new Error("Link-set fixture: no epoch derives the requested hash");
}
