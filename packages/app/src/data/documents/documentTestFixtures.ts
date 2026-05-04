import {
  type AccessEvent,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeWriteHeaderHash,
  encryptWithDek,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signWriteHeader,
  toFingerprint,
  type WriteHeader,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
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
import { createContainerWriterProjectionFixture } from "../../../test/helpers/createContainerWriterProjectionFixture";
import { buildMaterializedDocumentCreatePlan } from "../../workflows/documents/create";
import type { buildDocumentSyncPlan } from "../../workflows/documents/sync";
import { buildDocumentCreatePlan } from "./shared/events";
import { deriveDocumentCreateTargets } from "./shared/projection";
import type { DocumentCreateAuthor, DocumentCreatePlan } from "./shared/types";

interface DeepNonCanonicalRecord {
  next?: DeepNonCanonicalRecord;
  notJson?: undefined;
}

export function createDeepNonCanonicalRecord(
  depth: number,
): DeepNonCanonicalRecord {
  const root: DeepNonCanonicalRecord = {};
  let cursor = root;

  for (let index = 0; index < depth; index += 1) {
    const next: DeepNonCanonicalRecord = {};
    cursor.next = next;
    cursor = next;
  }

  cursor.notJson = undefined;
  return root;
}

export async function fixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`document:${label}`));
}

export async function createProjection(): Promise<ContainerWriterProjectionResponse> {
  const containerId = "container-1";
  const organizationId = "organization-1";
  const manifestHash = await fixtureHash("container-manifest");
  const keyEpochHash = await fixtureHash("container-key-epoch");
  const keyTargetHash = await fixtureHash("container-key-target");

  return {
    containerId,
    organizationId,
    path: [
      {
        event: {
          event: {},
          body: {},
          eventHash: await fixtureHash("container-event"),
        },
        manifest: {},
        manifestHash,
        state: {
          containerId,
          organizationId,
        },
      },
    ],
    containerKeks: [
      {
        containerId,
        accessManifestHash: manifestHash,
        containerKeyEpochId: "container-key-epoch-1",
        containerKeyEpoch: 1,
        keyEpoch: {},
        keyEpochHash,
        keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: [{}],
        wraps: [{}],
      },
    ],
  };
}

async function createUserContainerWrap(input: {
  containerKeyEpochId: string;
  containerKek: Uint8Array;
  publicKey: Uint8Array;
  userId: string;
  wrapManifestHash: string;
}) {
  const [recipient] = await wrapDekForRecipients(input.containerKek, [
    input.publicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected recipient wrap");
  }

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "user" as const,
    recipientId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:epoch-1`,
    recipientKeyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
    wrapManifestHash: input.wrapManifestHash,
  };
}

async function createContainerWrap(input: {
  childContainerKeyEpochId: string;
  childKek: Uint8Array;
  parentContainerId: string;
  parentContainerKeyEpochId: string;
  parentKeyEpochHash: string;
  parentKek: Uint8Array;
  wrapManifestHash: string;
}) {
  const encrypted = await encryptWithDek(input.childKek, input.parentKek);

  return {
    containerKeyEpochId: input.childContainerKeyEpochId,
    recipientKind: "container" as const,
    recipientId: input.parentContainerId,
    recipientKeyEpochId: input.parentContainerKeyEpochId,
    recipientKeyFingerprint: input.parentKeyEpochHash,
    kemCipherText: bytesToBase64(encrypted.iv),
    wrappedKey: bytesToBase64(encrypted.ciphertext),
    wrapManifestHash: input.wrapManifestHash,
  };
}

interface WrappedProjectionFixture {
  childContainerKek: Uint8Array;
  childContainerKeyEpochId: string;
  projection: ContainerWriterProjectionResponse;
  rootContainerKek: Uint8Array;
  rootContainerKeyEpochId: string;
  secretKey: Uint8Array;
}

function buildWrappedProjection(input: {
  childContainerId: string;
  childContainerKeyEpochId: string;
  childEventHash: string;
  childKeyEpochHash: string;
  childKeyTargetHash: string;
  childManifestHash: string;
  childWrap: ReturnType<typeof createContainerWrap> extends Promise<infer T>
    ? T
    : never;
  organizationId: string;
  rootContainerId: string;
  rootContainerKeyEpochId: string;
  rootEventHash: string;
  rootKeyEpochHash: string;
  rootKeyTargetHash: string;
  rootManifestHash: string;
  rootWrap: ReturnType<typeof createUserContainerWrap> extends Promise<infer T>
    ? T
    : never;
}): ContainerWriterProjectionResponse {
  const {
    childContainerId,
    childContainerKeyEpochId,
    childEventHash,
    childKeyEpochHash,
    childKeyTargetHash,
    childManifestHash,
    childWrap,
    organizationId,
    rootContainerId,
    rootContainerKeyEpochId,
    rootEventHash,
    rootKeyEpochHash,
    rootKeyTargetHash,
    rootManifestHash,
    rootWrap,
  } = input;

  return {
    containerId: childContainerId,
    organizationId,
    path: [
      {
        event: { event: {}, body: {}, eventHash: rootEventHash },
        manifest: {},
        manifestHash: rootManifestHash,
        state: { containerId: rootContainerId, organizationId },
      },
      {
        event: { event: {}, body: {}, eventHash: childEventHash },
        manifest: {},
        manifestHash: childManifestHash,
        state: { containerId: childContainerId, organizationId },
      },
    ],
    containerKeks: [
      {
        containerId: rootContainerId,
        accessManifestHash: rootManifestHash,
        containerKeyEpochId: rootContainerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: {
          id: rootContainerKeyEpochId,
          containerId: rootContainerId,
          keyEpoch: 1,
          accessManifestHash: rootManifestHash,
          parentContainerKeyEpochId: null,
          createdByEventHash: rootEventHash,
          createdByManifestHash: rootManifestHash,
        },
        keyEpochHash: rootKeyEpochHash,
        keyTargetHash: rootKeyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: [{}],
        wraps: [rootWrap],
      },
      {
        containerId: childContainerId,
        accessManifestHash: childManifestHash,
        containerKeyEpochId: childContainerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: {
          id: childContainerKeyEpochId,
          containerId: childContainerId,
          keyEpoch: 1,
          accessManifestHash: childManifestHash,
          parentContainerKeyEpochId: rootContainerKeyEpochId,
          createdByEventHash: childEventHash,
          createdByManifestHash: childManifestHash,
        },
        keyEpochHash: childKeyEpochHash,
        keyTargetHash: childKeyTargetHash,
        parentContainerKeyEpochId: rootContainerKeyEpochId,
        recipientTargets: [{}],
        wraps: [childWrap],
      },
    ],
  };
}

export async function createWrappedProjection(): Promise<WrappedProjectionFixture> {
  const keyPair = generateKemSeedAndKeyPair();
  const rootContainerId = "root-container";
  const childContainerId = "child-container";
  const organizationId = "organization-1";
  const rootManifestHash = await fixtureHash("root-container-manifest");
  const childManifestHash = await fixtureHash("child-container-manifest");
  const rootEventHash = await fixtureHash("root-container-event");
  const childEventHash = await fixtureHash("child-container-event");
  const rootKeyEpochHash = await fixtureHash("root-container-key-epoch");
  const childKeyEpochHash = await fixtureHash("child-container-key-epoch");
  const rootKeyTargetHash = await fixtureHash("root-container-key-target");
  const childKeyTargetHash = await fixtureHash("child-container-key-target");
  const rootContainerKeyEpochId = "root-container-key-epoch-1";
  const childContainerKeyEpochId = "child-container-key-epoch-1";
  const rootContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const childContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const rootWrap = await createUserContainerWrap({
    containerKeyEpochId: rootContainerKeyEpochId,
    containerKek: rootContainerKek,
    publicKey: keyPair.publicKey,
    userId: "user-1",
    wrapManifestHash: rootManifestHash,
  });
  const childWrap = await createContainerWrap({
    childContainerKeyEpochId,
    childKek: childContainerKek,
    parentContainerId: rootContainerId,
    parentContainerKeyEpochId: rootContainerKeyEpochId,
    parentKeyEpochHash: rootKeyEpochHash,
    parentKek: rootContainerKek,
    wrapManifestHash: childManifestHash,
  });

  return {
    childContainerKek,
    childContainerKeyEpochId,
    projection: buildWrappedProjection({
      childContainerId,
      childContainerKeyEpochId,
      childEventHash,
      childKeyEpochHash,
      childKeyTargetHash,
      childManifestHash,
      childWrap,
      organizationId,
      rootContainerId,
      rootContainerKeyEpochId,
      rootEventHash,
      rootKeyEpochHash,
      rootKeyTargetHash,
      rootManifestHash,
      rootWrap,
    }),
    rootContainerKek,
    rootContainerKeyEpochId,
    secretKey: keyPair.secretKey,
  };
}

export async function createSiblingProjection(input: {
  baseProjection: ContainerWriterProjectionResponse;
  rootContainerKek: Uint8Array;
}): Promise<{
  projection: ContainerWriterProjectionResponse;
  siblingContainerKek: Uint8Array;
  siblingContainerKeyEpochId: string;
}> {
  const rootManifest = input.baseProjection.path[0];
  const rootKek = input.baseProjection.containerKeks[0];
  if (!rootManifest || !rootKek) {
    throw new Error("Expected root projection fixture");
  }

  const siblingContainerId = "sibling-container";
  const siblingManifestHash = await fixtureHash("sibling-container-manifest");
  const siblingEventHash = await fixtureHash("sibling-container-event");
  const siblingKeyEpochHash = await fixtureHash("sibling-container-key-epoch");
  const siblingKeyTargetHash = await fixtureHash(
    "sibling-container-key-target",
  );
  const siblingContainerKeyEpochId = "sibling-container-key-epoch-1";
  const siblingContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const siblingWrap = await createContainerWrap({
    childContainerKeyEpochId: siblingContainerKeyEpochId,
    childKek: siblingContainerKek,
    parentContainerId: rootKek.containerId,
    parentContainerKeyEpochId: rootKek.containerKeyEpochId,
    parentKeyEpochHash: rootKek.keyEpochHash,
    parentKek: input.rootContainerKek,
    wrapManifestHash: siblingManifestHash,
  });

  return {
    projection: {
      containerId: siblingContainerId,
      organizationId: input.baseProjection.organizationId,
      path: [
        rootManifest,
        {
          event: {
            event: {},
            body: {},
            eventHash: siblingEventHash,
          },
          manifest: {},
          manifestHash: siblingManifestHash,
          state: {
            containerId: siblingContainerId,
            organizationId: input.baseProjection.organizationId,
          },
        },
      ],
      containerKeks: [
        rootKek,
        {
          containerId: siblingContainerId,
          accessManifestHash: siblingManifestHash,
          containerKeyEpochId: siblingContainerKeyEpochId,
          containerKeyEpoch: 1,
          keyEpoch: {
            id: siblingContainerKeyEpochId,
            containerId: siblingContainerId,
            keyEpoch: 1,
            accessManifestHash: siblingManifestHash,
            parentContainerKeyEpochId: rootKek.containerKeyEpochId,
            createdByEventHash: siblingEventHash,
            createdByManifestHash: siblingManifestHash,
          },
          keyEpochHash: siblingKeyEpochHash,
          keyTargetHash: siblingKeyTargetHash,
          parentContainerKeyEpochId: rootKek.containerKeyEpochId,
          recipientTargets: [{}],
          wraps: [siblingWrap],
        },
      ],
    },
    siblingContainerKek,
    siblingContainerKeyEpochId,
  };
}

export async function createAuthor(): Promise<{
  author: DocumentCreateAuthor;
  signingPublicKey: Uint8Array;
}> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  return {
    author: {
      organizationId: "organization-1",
      signerDeviceId: "test-device-1",
      signerKeyFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      signerUserId: "user-1",
    },
    signingPublicKey: signingKeyPair.signingPublicKey,
  };
}

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
  const targetContainerId = String(Reflect.get(body, "containerId"));
  const previousLinkedContainerIds = (
    Reflect.get(request.previousManifest.state, "linkedContainerIds") as
      | unknown[]
      | undefined
  )
    ?.filter(
      (containerId): containerId is string => typeof containerId === "string",
    )
    .sort();
  if (!previousLinkedContainerIds) {
    throw new Error("Expected previous linked container ids");
  }

  const linkedContainerIds =
    Reflect.get(body, "eventType") === "document.link"
      ? [...new Set([...previousLinkedContainerIds, targetContainerId])].sort()
      : previousLinkedContainerIds.filter(
          (containerId) => containerId !== targetContainerId,
        );
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
        previousManifestHash: request.previousManifest.manifestHash,
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
  const resolveProjectionUserKey = async (userId: string) =>
    userId === author.signerUserId
      ? {
          encapsulationPublicKey: keyPair.publicKey,
          signingPublicKey,
          userId,
        }
      : null;
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "550e8400-e29b-41d4-a716-446655440010",
    eventId: "event-materialized-sync",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    documentId: response.id,
    documentManifest: response.accessManifest,
    documentKekTargets: response.documentKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    authorizingContainerPaths: [projection],
  };

  return {
    author,
    contentKey,
    createResponse: response,
    projection,
    resolveProjectionUserKey,
    secretKey: keyPair.secretKey,
    signingPublicKey,
    writerProjection,
  };
}

export async function createPreparedUpdate(
  overrides: {
    checkpointKind?: "fresh_baseline" | "rotate_baseline" | undefined;
    ciphertextHash?: string | undefined;
    contentRecordId?: string | undefined;
    encryptedData?: string | undefined;
    id?: string | undefined;
    metadataHash?: string | undefined;
    partialEndVersionVector?: string | undefined;
    partialStartVersionVector?: string | undefined;
    signedAt?: string | undefined;
    sourceVersionVector?: string | undefined;
  } = {},
) {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: overrides.encryptedData ?? "encrypted-update",
    partialStartVersionVector: overrides.partialStartVersionVector ?? "{}",
    partialEndVersionVector: overrides.partialEndVersionVector ?? '{"actor":1}',
    metadataHash: overrides.metadataHash ?? (await fixtureHash("metadata")),
    ciphertextHash:
      overrides.ciphertextHash ?? (await fixtureHash("ciphertext")),
    ...(overrides.checkpointKind === undefined
      ? {}
      : { checkpointKind: overrides.checkpointKind }),
    ...(overrides.contentRecordId === undefined
      ? {}
      : { contentRecordId: overrides.contentRecordId }),
    ...(overrides.signedAt === undefined
      ? {}
      : { signedAt: overrides.signedAt }),
    ...(overrides.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: overrides.sourceVersionVector }),
  };
}

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
    updateData:
      overrides.updateData ??
      bytesToBase64(new TextEncoder().encode("materialized update")),
    partialStartVersionVector: overrides.partialStartVersionVector ?? "{}",
    partialEndVersionVector: overrides.partialEndVersionVector ?? '{"actor":2}',
    sourceVersionVector: overrides.sourceVersionVector ?? null,
  };
}

export function projectionPathRecords(
  projection: ContainerWriterProjectionResponse,
): Record<string, unknown>[] {
  return projection.path.map(
    (bundle) => bundle as unknown as Record<string, unknown>,
  );
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
        id: update.id,
        documentId: plan.documentId,
        authorFingerprint: writeHeader.writerKeyFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        createdAt: "2026-04-27T00:00:00.000Z",
        writeHeader: update.writeHeader,
        writeHeaderHash: await computeWriteHeaderHash(writeHeader),
      };
    }),
  );

  return {
    acceptedOutgoingUpdateIds: plan.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: "0/16B6C50",
    contentKeyBundle: plan.sourceContentKeyBundle,
    documentId: plan.documentId,
    documentKekTargets: plan.documentKekTargets,
    missingUpdateEpochs: updates.length === 0 ? [] : ["current_epoch"],
    updates,
    ...overrides,
  };
}

export async function createSignedSyncResponseUpdate(input: {
  accessManifestHash: string;
  author: DocumentCreateAuthor;
  id?: string | undefined;
  plan: Awaited<ReturnType<typeof buildDocumentSyncPlan>>;
  targetHash: string;
}): Promise<DocumentSyncResponse["updates"][number]> {
  const id = input.id ?? "550e8400-e29b-41d4-a716-446655440555";
  const encryptedData = "historical encrypted update";
  const partialStartVersionVector = "{}";
  const partialEndVersionVector = '{"actor":3}';
  const nonceDomain = {
    version: 1 as const,
    organizationId: input.plan.organizationId,
    objectKind: "document" as const,
    objectId: input.plan.documentId,
    contentKeyEpoch: input.plan.contentKeyEpoch,
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
    createdAt: "2026-04-27T00:00:00.000Z",
    writeHeader: writeHeader as unknown as Record<string, unknown>,
    writeHeaderHash: await computeWriteHeaderHash(writeHeader),
  };
}
