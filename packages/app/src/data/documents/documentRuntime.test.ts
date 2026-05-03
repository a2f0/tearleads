import { expect, test } from "bun:test";
import {
  type AccessEvent,
  BLOB_CONTENT_KEY_WRAP_SUITE,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeWriteHeaderHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  signWriteHeader,
  toFingerprint,
  verifySignedAccessEvent,
  verifyWriteHeader,
  type WriteHeader,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type DocumentCreateRequest,
  type DocumentLinkSetMutationRequest,
  type DocumentSyncRequest,
  isDocumentCreateRequest,
  isDocumentLinkSetMutationRequest,
  isDocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createContainerWriterProjectionFixture } from "../../../test/helpers/createContainerWriterProjectionFixture";
import type { BlobBytes } from "../blobs";
import { uploadDocumentAttachment } from "./blobRuntime";
import {
  buildDocumentCreatePlan,
  buildDocumentSyncPlan,
  buildMaterializedDocumentCreatePlan,
  buildMaterializedDocumentLinkSetMutationPlan,
  buildMaterializedDocumentSyncPlan,
  createRemoteDocument,
  type DocumentCreateAuthor,
  type DocumentCreatePlan,
  decryptDocumentSyncUpdates,
  deriveDocumentCreateTargets,
  persistedDocumentCreateStateFromResponse,
  persistedDocumentLinkSetMutationStateFromResponse,
  persistedDocumentSyncStateFromResponse,
  relinkRemoteDocument,
  syncRemoteDocument,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "./documentRuntime";

interface DeepNonCanonicalRecord {
  next?: DeepNonCanonicalRecord;
  notJson?: undefined;
}

interface ContentRecordFields {
  ciphertext?: unknown;
  contentRecordId?: unknown;
  iv?: unknown;
  nonceDomainHash?: unknown;
}

function createDeepNonCanonicalRecord(depth: number): DeepNonCanonicalRecord {
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

async function fixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`document:${label}`));
}

async function createProjection(): Promise<ContainerWriterProjectionResponse> {
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

async function createWrappedProjection(): Promise<{
  childContainerKek: Uint8Array;
  childContainerKeyEpochId: string;
  projection: ContainerWriterProjectionResponse;
  rootContainerKek: Uint8Array;
  rootContainerKeyEpochId: string;
  secretKey: Uint8Array;
}> {
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
    projection: {
      containerId: childContainerId,
      organizationId,
      path: [
        {
          event: {
            event: {},
            body: {},
            eventHash: rootEventHash,
          },
          manifest: {},
          manifestHash: rootManifestHash,
          state: {
            containerId: rootContainerId,
            organizationId,
          },
        },
        {
          event: {
            event: {},
            body: {},
            eventHash: childEventHash,
          },
          manifest: {},
          manifestHash: childManifestHash,
          state: {
            containerId: childContainerId,
            organizationId,
          },
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
    },
    rootContainerKek,
    rootContainerKeyEpochId,
    secretKey: keyPair.secretKey,
  };
}

async function createSiblingProjection(input: {
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

async function createAuthor(): Promise<{
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

function createResponse(plan: DocumentCreatePlan): DocumentCreateResponse {
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

async function createResponseFromRequest(
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

async function createLinkSetResponseFromRequest(
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

function getOnlyTarget(
  projection: ContainerWriterProjectionResponse,
): ReturnType<typeof deriveDocumentCreateTargets>[number] {
  const target = deriveDocumentCreateTargets(projection)[0];
  if (!target) {
    throw new Error("Expected test projection to derive a document target");
  }
  return target;
}

test("buildDocumentCreatePlan signs an initial document link manifest from a container projection", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-1",
    eventId: "event-1",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetEnvelopes: [
      {
        ...target,
        wrappedKey: "wrapped-document-key",
        wrappingMetadata: {
          algorithm: "test-only",
        },
      },
    ],
  });

  expect(isDocumentCreateRequest(plan.request)).toBe(true);
  expect(plan.request.expectedManifestHash).toBe(plan.manifestHash);
  expect(plan.request.contentKeyBundle.linkSetManifestHash).toBe(
    plan.manifestHash,
  );
  expect(plan.request.contentKeyBundle.targetHash).toBe(plan.targetHash);
  const targetPathManifestHash = plan.request.targetContainerPath?.[0]
    ? Reflect.get(plan.request.targetContainerPath[0], "manifestHash")
    : undefined;
  expect(targetPathManifestHash).toBe(target.containerManifestHash);
  expect(plan.request.contentKeyBundle.targets).toEqual([
    {
      ...target,
      wrappedKey: "wrapped-document-key",
      wrappingMetadata: {
        algorithm: "test-only",
      },
    },
  ]);

  const verifiedEvent = await verifySignedAccessEvent({
    body: plan.body as unknown as KeyingCanonicalJson,
    event: plan.event as AccessEvent,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
});

test("buildDocumentCreatePlan rejects missing or stale content-key target envelopes", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);

  await expect(
    buildDocumentCreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-1",
      targetEnvelopes: [],
    }),
  ).rejects.toThrow("missing");

  await expect(
    buildDocumentCreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-1",
      targetEnvelopes: [
        {
          ...target,
          containerManifestHash: await fixtureHash("stale-manifest"),
          wrappedKey: "wrapped-document-key",
          wrappingMetadata: {},
        },
      ],
    }),
  ).rejects.toThrow("unexpected");
});

test("deriveDocumentCreateTargets uses the leaf projection manifest and KEK", async () => {
  const projection = await createProjection();
  const currentManifest = projection.path[0];
  const currentKek = projection.containerKeks[0];
  if (!currentManifest || !currentKek) {
    throw new Error("Expected test projection to include current state");
  }
  const staleManifestHash = await fixtureHash("stale-container-manifest");
  const staleKeyEpochHash = await fixtureHash("stale-container-key-epoch");
  const staleKeyTargetHash = await fixtureHash("stale-container-key-target");
  const staleManifest = {
    ...currentManifest,
    manifestHash: staleManifestHash,
  };
  const staleKek = {
    ...currentKek,
    accessManifestHash: staleManifestHash,
    containerKeyEpochId: "container-key-epoch-stale",
    containerKeyEpoch: 1,
    keyEpochHash: staleKeyEpochHash,
    keyTargetHash: staleKeyTargetHash,
  };
  const target = getOnlyTarget({
    ...projection,
    path: [staleManifest, ...projection.path],
    containerKeks: [staleKek, ...projection.containerKeks],
  });

  expect(target).toEqual({
    containerId: projection.containerId,
    containerManifestHash: currentManifest.manifestHash,
    containerKeyEpochId: currentKek.containerKeyEpochId,
    containerKeyEpoch: currentKek.containerKeyEpoch,
  });
});

test("unwrapContainerKekPath follows parent KEK edges to the leaf", async () => {
  const {
    childContainerKek,
    childContainerKeyEpochId,
    projection,
    rootContainerKek,
    rootContainerKeyEpochId,
    secretKey,
  } = await createWrappedProjection();
  await expect(
    unwrapContainerKekPath({
      projection,
      secretKey,
    } as Parameters<typeof unwrapContainerKekPath>[0]),
  ).rejects.toThrow("requires projection key verification");

  const unwrapped = await unwrapContainerKekPath({
    projection,
    secretKey,
    trustedLocalProjection: true,
  });

  expect(Array.from(unwrapped.get(rootContainerKeyEpochId) ?? [])).toEqual(
    Array.from(rootContainerKek),
  );
  expect(Array.from(unwrapped.get(childContainerKeyEpochId) ?? [])).toEqual(
    Array.from(childContainerKek),
  );
  const childKek = projection.containerKeks[1];
  if (!childKek) {
    throw new Error("Expected child container KEK fixture");
  }

  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [childKek],
      },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("inconsistent");

  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [
          projection.containerKeks[0] ?? childKek,
          {
            ...childKek,
            wraps: childKek.wraps.map((wrap) => ({
              ...wrap,
              recipientKeyFingerprint: "wrong-parent-key-epoch-hash",
            })),
          },
        ],
      },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("could not be unwrapped");
});

test("buildMaterializedDocumentCreatePlan wraps the content key to the target container KEK", async () => {
  const { author } = await createAuthor();
  const { childContainerKek, projection, secretKey } =
    await createWrappedProjection();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const materialized = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-materialized",
    eventId: "event-materialized",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const [targetEnvelope] = materialized.plan.request.contentKeyBundle.targets;
  if (!targetEnvelope) {
    throw new Error("Expected a materialized content-key target");
  }
  const unwrappedContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: childContainerKek,
    envelope: targetEnvelope,
  });

  expect(Array.from(materialized.contentKey)).toEqual(Array.from(contentKey));
  expect(Array.from(unwrappedContentKey)).toEqual(Array.from(contentKey));
  expect(targetEnvelope.wrappingMetadata).toEqual(
    expect.objectContaining({
      suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
    }),
  );
  const childManifest = projection.path[1];
  const childKek = projection.containerKeks[1];
  if (!childManifest || !childKek) {
    throw new Error("Expected child projection fixture");
  }
  expect(materialized.plan.targets).toEqual([
    {
      containerId: projection.containerId,
      containerManifestHash: childManifest.manifestHash,
      containerKeyEpochId: childKek.containerKeyEpochId,
      containerKeyEpoch: 1,
    },
  ]);
  expect(isDocumentCreateRequest(materialized.plan.request)).toBe(true);
});

test("createRemoteDocument submits the materialized request and persists the verified response", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "remote-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const submittedRequests: DocumentCreateRequest[] = [];
  const created = await createRemoteDocument({
    apiClient: {
      createDocument: async (request) => {
        submittedRequests.push(request);
        return createResponseFromRequest(request);
      },
      getContainerWriterProjection: async (containerId) =>
        containerId === projection.containerId ? projection : null,
    },
    author,
    containerId: projection.containerId,
    documentId: "document-remote",
    eventId: "event-remote",
    resolveProjectionUserKey: async (userId) =>
      userId === author.signerUserId
        ? {
            encapsulationPublicKey: keyPair.publicKey,
            signingPublicKey,
            userId,
          }
        : null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
  });

  expect(created?.documentId).toBe("document-remote");
  if (!created) {
    throw new Error("Expected remote document create result");
  }
  expect(submittedRequests).toHaveLength(1);
  expect(created.persistedState).toEqual({
    documentId: "document-remote",
    contentKeyBundle: JSON.stringify(created.response.contentKeyBundle),
    documentKekTargets: JSON.stringify(created.response.documentKekTargets),
    documentManifestBundle: JSON.stringify(created.response.accessManifest),
  });
});

test("persistedDocumentCreateStateFromResponse stores verified create bundles", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-1",
    targetEnvelopes: [
      {
        ...target,
        wrappedKey: "wrapped-document-key",
        wrappingMetadata: {},
      },
    ],
  });
  const response = createResponse(plan);
  const tamperedTargetHash = await fixtureHash("tampered-target");

  expect(persistedDocumentCreateStateFromResponse(plan, response)).toEqual({
    documentId: "document-1",
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(response.accessManifest),
  });

  expect(() =>
    persistedDocumentCreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targetHash: tamperedTargetHash,
      },
    }),
  ).toThrow("target hash mismatch");

  expect(() =>
    persistedDocumentCreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targets: [],
      },
    }),
  ).toThrow("content-key targets mismatch");
});

test("buildMaterializedDocumentLinkSetMutationPlan adds links without rotating and unlinks with a rotated content key", async () => {
  const { author } = await createAuthor();
  const { childContainerKek, projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection, siblingContainerKek } =
    await createSiblingProjection({
      baseProjection: projection,
      rootContainerKek,
    });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-link-set",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };

  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  expect(isDocumentLinkSetMutationRequest(linked.plan.request)).toBe(true);
  expect(linked.contentKeyRotated).toBe(false);
  expect(linked.plan.contentKeyEpoch).toBe(1);
  expect(linked.plan.state.linkedContainerIds).toEqual(
    [projection.containerId, siblingProjection.containerId].sort(),
  );
  expect(linked.plan.targets.map((target) => target.containerId)).toEqual(
    [projection.containerId, siblingProjection.containerId].sort(),
  );
  const siblingEnvelope = linked.plan.request.contentKeyBundle.targets.find(
    (target) => target.containerId === siblingProjection.containerId,
  );
  if (!siblingEnvelope) {
    throw new Error("Expected sibling content-key envelope");
  }
  await expect(
    unwrapDocumentContentKeyTarget({
      containerKek: childContainerKek,
      envelope: siblingEnvelope,
    }),
  ).rejects.toThrow();
  const siblingContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: siblingContainerKek,
    envelope: siblingEnvelope,
  });
  expect(Array.from(siblingContentKey)).toEqual(Array.from(contentKey));

  const linkResponse = await createLinkSetResponseFromRequest(
    writerProjection.documentId,
    linked.plan.request,
  );
  const rotatedContentKey = crypto.getRandomValues(new Uint8Array(32));
  const unlinked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    contentKey: rotatedContentKey,
    operation: "unlink",
    signedAt: "2026-04-27T00:00:01.000Z",
    targetContainerProjection: projection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection: {
      authorizingContainerPaths: [projection, siblingProjection],
      contentKeyBundle: linkResponse.contentKeyBundle,
      documentId: linkResponse.id,
      documentKekTargets: linkResponse.documentKekTargets,
      documentManifest: linkResponse.accessManifest,
    },
  });

  expect(unlinked.contentKeyRotated).toBe(true);
  expect(unlinked.plan.contentKeyEpoch).toBe(2);
  expect(unlinked.plan.state.linkedContainerIds).toEqual([
    siblingProjection.containerId,
  ]);
  expect(unlinked.plan.targets.map((target) => target.containerId)).toEqual([
    siblingProjection.containerId,
  ]);
  const [remainingEnvelope] = unlinked.plan.request.contentKeyBundle.targets;
  if (!remainingEnvelope) {
    throw new Error("Expected remaining content-key envelope");
  }
  const remainingContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: siblingContainerKek,
    envelope: remainingEnvelope,
  });
  expect(Array.from(remainingContentKey)).toEqual(
    Array.from(rotatedContentKey),
  );
});

test("buildMaterializedDocumentLinkSetMutationPlan rejects split writer projection target hashes", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection } = await createSiblingProjection({
    baseProjection: projection,
    rootContainerKek,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-link-set-split-projection",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const splitTargetHash = await fixtureHash("split-writer-projection-target");

  await expect(
    buildMaterializedDocumentLinkSetMutationPlan({
      author,
      operation: "link",
      targetContainerProjection: siblingProjection,
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        authorizingContainerPaths: [projection],
        contentKeyBundle: {
          ...createdResponse.contentKeyBundle,
          targetHash: splitTargetHash,
        },
        documentId: createdResponse.id,
        documentKekTargets: {
          ...createdResponse.documentKekTargets,
          documentKeyTargetHash: splitTargetHash,
        },
        documentManifest: createdResponse.accessManifest,
      },
    }),
  ).rejects.toThrow("writer projection target hash is not canonical");
});

test("buildMaterializedDocumentSyncPlan rejects authorizing paths outside the document targets", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection } = await createSiblingProjection({
    baseProjection: projection,
    rootContainerKek,
  });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-sync-forged-authorization-path",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const childTarget = getOnlyTarget(projection);
  const siblingEnvelope = linked.plan.request.contentKeyBundle.targets.find(
    (target) => target.containerId === siblingProjection.containerId,
  );
  if (!siblingEnvelope) {
    throw new Error("Expected sibling content-key envelope fixture");
  }

  const forgedEnvelope = {
    ...siblingEnvelope,
    containerId: childTarget.containerId,
    containerManifestHash: childTarget.containerManifestHash,
  };
  const forgedTarget = {
    containerId: forgedEnvelope.containerId,
    containerManifestHash: forgedEnvelope.containerManifestHash,
    containerKeyEpochId: forgedEnvelope.containerKeyEpochId,
    containerKeyEpoch: forgedEnvelope.containerKeyEpoch,
  };
  const forgedTargetHash = await computeDocumentContentKeyTargetHash([
    forgedTarget,
  ]);

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        authorizingContainerPaths: [siblingProjection],
        contentKeyBundle: {
          ...createdResponse.contentKeyBundle,
          targetHash: forgedTargetHash,
          targets: [forgedEnvelope],
        },
        documentId: createdResponse.id,
        documentKekTargets: {
          ...createdResponse.documentKekTargets,
          documentKeyTargetHash: forgedTargetHash,
          linkedContainerKeyEpochIds: [forgedTarget.containerKeyEpochId],
          linkedContainerManifestHashes: [forgedTarget.containerManifestHash],
          targets: [forgedTarget],
        },
        documentManifest: createdResponse.accessManifest,
      },
    }),
  ).rejects.toThrow("authorization path[0] is not a document target");
});

test("buildMaterializedDocumentSyncPlan names malformed authorizing path indexes", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const sourceProjection = writerProjection.authorizingContainerPaths[0];
  if (!sourceProjection) {
    throw new Error("Expected authorizing path fixture");
  }
  const leafIndex = sourceProjection.path.length - 1;
  const malformedProjection: ContainerWriterProjectionResponse = {
    ...sourceProjection,
    path: sourceProjection.path.map((bundle, index) =>
      index === leafIndex
        ? {
            ...bundle,
            state: {
              ...bundle.state,
              containerId: "wrong-authorizing-path-container",
            },
          }
        : bundle,
    ),
  };

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      localVersionVector: null,
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        ...writerProjection,
        authorizingContainerPaths: [malformedProjection],
      },
    }),
  ).rejects.toThrow(
    "authorization path[0] is invalid: Container writer projection target path is inconsistent",
  );
});

test("buildMaterializedDocumentLinkSetMutationPlan names inaccessible remaining KEKs during unlink", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection, siblingContainerKeyEpochId } =
    await createSiblingProjection({
      baseProjection: projection,
      rootContainerKek,
    });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-link-set-missing-kek",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    writerProjection.documentId,
    linked.plan.request,
  );
  const inaccessibleSiblingProjection: ContainerWriterProjectionResponse = {
    ...siblingProjection,
    containerKeks: siblingProjection.containerKeks.map((kek, index) =>
      index === siblingProjection.containerKeks.length - 1
        ? { ...kek, wraps: [] }
        : kek,
    ),
  };

  await expect(
    buildMaterializedDocumentLinkSetMutationPlan({
      author,
      operation: "unlink",
      targetContainerProjection: projection,
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        authorizingContainerPaths: [projection, inaccessibleSiblingProjection],
        contentKeyBundle: linkResponse.contentKeyBundle,
        documentId: linkResponse.id,
        documentKekTargets: linkResponse.documentKekTargets,
        documentManifest: linkResponse.accessManifest,
      },
    }),
  ).rejects.toThrow(
    `container ${siblingProjection.containerId} epoch ${siblingContainerKeyEpochId}`,
  );
});

test("relinkRemoteDocument submits a verified signed link-set mutation", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "remote-link-root-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const siblingProjection = await createContainerWriterProjectionFixture({
    containerId: "remote-link-sibling-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    parentProjection: projection,
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
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-remote-link",
    resolveProjectionUserKey,
    targetSecretKey: keyPair.secretKey,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const submittedRequests: DocumentLinkSetMutationRequest[] = [];

  const linked = await relinkRemoteDocument({
    apiClient: {
      getContainerWriterProjection: async (containerId) =>
        containerId === siblingProjection.containerId
          ? siblingProjection
          : null,
      getDocumentWriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      linkDocument: async (documentId, request) => {
        submittedRequests.push(request);
        return createLinkSetResponseFromRequest(documentId, request);
      },
      unlinkDocument: async () => {
        throw new Error("Unexpected unlink call");
      },
    },
    author,
    documentId: writerProjection.documentId,
    operation: "link",
    resolveProjectionUserKey,
    targetContainerId: siblingProjection.containerId,
    targetSecretKey: keyPair.secretKey,
  });

  expect(submittedRequests).toHaveLength(1);
  expect(linked?.contentKeyRotated).toBe(false);
  expect(linked?.linkedContainerIds).toEqual(
    [projection.containerId, siblingProjection.containerId].sort(),
  );
  if (!linked) {
    throw new Error("Expected remote link result");
  }
  expect(
    persistedDocumentLinkSetMutationStateFromResponse(
      linked.plan,
      linked.response,
    ),
  ).toEqual(linked.persistedState);
});

async function createSyncFixture() {
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

async function createMaterializedSyncFixture() {
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

async function createPreparedUpdate(
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

function createPendingUpdateRecord(
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

function projectionPathRecords(
  projection: ContainerWriterProjectionResponse,
): Record<string, unknown>[] {
  return projection.path.map(
    (bundle) => bundle as unknown as Record<string, unknown>,
  );
}

async function createSyncResponse(
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

async function createSignedSyncResponseUpdate(input: {
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

test("buildDocumentSyncPlan signs document write headers with the current access boundary", async () => {
  const { author, createResponse, projection, signingPublicKey } =
    await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    authorizingContainerPaths: [projectionPathRecords(projection)],
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [
      await createPreparedUpdate({
        checkpointKind: "fresh_baseline",
        signedAt: "2026-04-27T00:00:01.000Z",
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.documentManifest?.manifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(plan.request.contentKeyBundle?.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(
    Reflect.get(
      plan.request.authorizingContainerPaths?.[0]?.[0] ?? {},
      "manifestHash",
    ),
  ).toBe(projection.path[0]?.manifestHash);
  const update = plan.request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected a signed outgoing update");
  }
  const writeHeader = update.writeHeader as unknown as WriteHeader;
  expect(writeHeader.objectKind).toBe("document");
  expect(writeHeader.objectId).toBe(plan.documentId);
  expect(writeHeader.organizationId).toBe(author.organizationId);
  expect(writeHeader.accessManifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(writeHeader.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(writeHeader.encryptionSuite).toBe(CONTENT_RECORD_ENCRYPTION_SUITE);

  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: createResponse.accessManifest.manifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: plan.documentId,
      organizationId: author.organizationId,
    },
    expectedTargetHash: createResponse.contentKeyBundle.targetHash,
    header: writeHeader,
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);
});

test("buildDocumentSyncPlan omits write-only fields for read-only syncs", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: "{}",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.documentManifest).toBeUndefined();
  expect(plan.request.authorizingContainerPaths).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan rejects manifest bundles whose state does not derive the manifest", async () => {
  const { author, createResponse, projection } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        state: {
          ...createResponse.accessManifest.state,
          linkedContainerIds: [projection.containerId, "forged-container-link"],
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("manifest state mismatch");
});

test("buildDocumentSyncPlan rejects malformed manifest event envelopes before hashing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();
  const event = Reflect.get(createResponse.accessManifest.event, "event");
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Expected signed event fixture");
  }

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        event: {
          ...createResponse.accessManifest.event,
          event: {
            ...(event as Record<string, unknown>),
            eventType: "document.move",
          },
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("signed event.eventType is invalid");
});

test("buildDocumentSyncPlan rejects deeply nested non-canonical manifest records without overflowing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        event: {
          ...createResponse.accessManifest.event,
          event: {
            ...(Reflect.get(
              createResponse.accessManifest.event,
              "event",
            ) as Record<string, unknown>),
            unexpectedDeepValue: createDeepNonCanonicalRecord(20_000),
          },
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("must be canonical JSON");
});

test("buildDocumentSyncPlan rejects duplicate content record domains before signing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();
  const duplicateContentRecordId = "550e8400-e29b-41d4-a716-446655440333";

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: createResponse.accessManifest,
      localVersionVector: null,
      outgoingUpdates: [
        await createPreparedUpdate({
          contentRecordId: duplicateContentRecordId,
          id: "550e8400-e29b-41d4-a716-446655440222",
        }),
        await createPreparedUpdate({
          contentRecordId: duplicateContentRecordId.toUpperCase(),
          id: "550e8400-e29b-41d4-a716-446655440223",
        }),
      ],
    }),
  ).rejects.toThrow("content record id is duplicated");
});

test("buildMaterializedDocumentSyncPlan unwraps the content key and encrypts pending updates", async () => {
  const { author, contentKey, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const plan = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        sourceVersionVector: "rotate-frontier",
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  expect(Array.from(plan.contentKey)).toEqual(Array.from(contentKey));
  expect(isDocumentSyncRequest(plan.plan.request)).toBe(true);
  const update = plan.plan.request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected materialized outgoing update");
  }
  expect(update.checkpointKind).toBe("rotate_baseline");
  expect(update.sourceVersionVector).toBe("rotate-frontier");
  expect(update.encryptedData).toContain("tearleads.document.loro-update");
  expect(update.encryptedData).not.toContain("materialized update");

  const writeHeader = update.writeHeader as unknown as WriteHeader;
  expect(writeHeader.contentRecordId).toBe(update.id);
  expect(writeHeader.ciphertextHash).toHaveLength(64);
  expect(writeHeader.metadataHash).toHaveLength(64);
  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: writerProjection.documentManifest.manifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: writerProjection.documentId,
      organizationId: author.organizationId,
    },
    expectedTargetHash: writerProjection.contentKeyBundle.targetHash,
    header: writeHeader,
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);
});

test("buildMaterializedDocumentSyncPlan rejects document writer projections with bad signatures", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "verified-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440099",
    eventId: "event-bad-document-signature",
    resolveProjectionUserKey: async (userId) =>
      userId === author.signerUserId
        ? {
            encapsulationPublicKey: encapsulationKeyPair.publicKey,
            signingPublicKey,
            userId,
          }
        : null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    documentId: response.id,
    documentManifest: response.accessManifest,
    documentKekTargets: response.documentKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    authorizingContainerPaths: [projection],
  };
  const signedEvent = writerProjection.documentManifest.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed document event fixture");
  }

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey: async (userId) =>
        userId === author.signerUserId
          ? {
              encapsulationPublicKey: encapsulationKeyPair.publicKey,
              signingPublicKey,
              userId,
            }
          : null,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection: {
        ...writerProjection,
        documentManifest: {
          ...writerProjection.documentManifest,
          event: {
            ...writerProjection.documentManifest.event,
            event: {
              ...signedEvent,
              signature: `${signature.slice(0, -1)}${
                signature.endsWith("A") ? "B" : "A"
              }`,
            },
          },
        },
      },
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
});

test("uploadDocumentAttachment wraps blob keys with the blob content-key suite", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440555";
  const bindingId = "550e8400-e29b-41d4-a716-446655440556";
  const slotId = "preview";
  const submittedResponses: {
    readonly contentKeyBundle: {
      readonly targets: readonly { readonly wrappingMetadata: unknown }[];
    };
  }[] = [];

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      bindBlobAttachment: async (_blobId, request) => {
        const targets = request.contentKeyBundle.targets;
        const targetRecords = targets.map((target) => ({ ...target }));
        const linkedContainerManifestHashes = [
          ...new Set(targets.map((target) => target.containerManifestHash)),
        ].sort();
        const linkedContainerKeyEpochIds = [
          ...new Set(targets.map((target) => target.containerKeyEpochId)),
        ].sort();
        const blobAccessManifestHash = await computeBlobAccessManifestHash({
          version: 1,
          blobId,
          organizationId: author.organizationId,
          activeBindingIds: [bindingId],
          documentManifestHashes: [
            writerProjection.documentManifest.manifestHash,
          ],
          linkedContainerManifestHashes,
          linkedContainerKeyEpochIds,
          blobKeyTargetHash: request.contentKeyBundle.targetHash,
        });
        if (!request.stagedBlob) {
          throw new Error("Expected staged blob request");
        }
        const response = {
          bindingId,
          blobId,
          documentId: writerProjection.documentId,
          slotId,
          contentKeyBundle: {
            blobId,
            ...request.contentKeyBundle,
          },
          blobKekTargets: {
            blobId,
            organizationId: author.organizationId,
            activeBindingIds: [bindingId],
            documentManifestHashes: [
              writerProjection.documentManifest.manifestHash,
            ],
            linkedContainerManifestHashes,
            linkedContainerKeyEpochIds,
            targets: targetRecords,
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
            blobAccessManifestHash,
          },
          writeHeaderHash: await computeWriteHeaderHash(
            request.stagedBlob.writeHeader as unknown as WriteHeader,
          ),
        };
        submittedResponses.push(response);
        return response;
      },
      getDocumentWriterProjection: async () => writerProjection,
      stageBlob: async () => ({
        stageId: "stage-blob-suite",
        expiresAt: "2026-04-27T01:00:00.000Z",
      }),
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array([1, 2, 3, 4]) as BlobBytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });

  expect(uploaded?.blobId).toBe(blobId);
  expect(submittedResponses[0]?.contentKeyBundle.targets).toEqual([
    expect.objectContaining({
      wrappingMetadata: expect.objectContaining({
        suite: BLOB_CONTENT_KEY_WRAP_SUITE,
      }),
    }),
  ]);
});

test("uploadDocumentAttachment rejects document writer projections with bad signatures before staging", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const tamperedProjection = structuredClone(writerProjection);
  const signedEvent = tamperedProjection.documentManifest.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed document event fixture");
  }
  signedEvent.signature = `${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;
  let stageCalled = false;
  let bindCalled = false;

  await expect(
    uploadDocumentAttachment({
      apiClient: {
        bindBlobAttachment: async () => {
          bindCalled = true;
          throw new Error("Unexpected bind");
        },
        getDocumentWriterProjection: async () => tamperedProjection,
        stageBlob: async () => {
          stageCalled = true;
          throw new Error("Unexpected stage");
        },
      },
      author,
      blobId: "550e8400-e29b-41d4-a716-446655440557",
      bytes: new Uint8Array([5, 6, 7]) as BlobBytes,
      documentId: writerProjection.documentId,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      slotId: "preview",
      targetSecretKey: secretKey,
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
  expect(stageCalled).toBe(false);
  expect(bindCalled).toBe(false);
});

test("buildMaterializedDocumentSyncPlan verifies linked document manifest history", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const rootProjection = await createContainerWriterProjectionFixture({
    containerId: "verified-root-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const childProjection = await createContainerWriterProjectionFixture({
    containerId: "verified-child-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    parentProjection: rootProjection,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: rootProjection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440098",
    eventId: "event-verified-document-history",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(materializedCreate.plan);
  const initialWriterProjection: DocumentWriterProjectionResponse = {
    documentId: createdResponse.id,
    documentManifest: createdResponse.accessManifest,
    documentKekTargets: createdResponse.documentKekTargets,
    contentKeyBundle: createdResponse.contentKeyBundle,
    authorizingContainerPaths: [rootProjection],
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    targetContainerProjection: childProjection,
    targetSecretKey: encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
    writerProjection: initialWriterProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    createdResponse.id,
    linked.plan.request,
  );
  const resolveProjectionUserKey = async (userId: string) =>
    userId === author.signerUserId
      ? {
          encapsulationPublicKey: encapsulationKeyPair.publicKey,
          signingPublicKey,
          userId,
        }
      : null;

  const syncPlan = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    writerProjection: {
      documentId: linkResponse.id,
      documentManifest: linkResponse.accessManifest,
      documentManifestHistory: [createdResponse.accessManifest],
      documentManifestContainerPaths: [
        rootProjection.path,
        childProjection.path,
      ],
      documentContainerManifestHistory: [
        ...rootProjection.path,
        ...childProjection.path,
      ],
      documentKekTargets: linkResponse.documentKekTargets,
      contentKeyBundle: linkResponse.contentKeyBundle,
      authorizingContainerPaths: [rootProjection, childProjection],
    },
  });

  expect(syncPlan.plan.documentManifest.manifestHash).toBe(
    linkResponse.accessManifest.manifestHash,
  );
});

test("buildMaterializedDocumentSyncPlan uses a fresh IV for same-domain re-encryption", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const sharedUpdate = createPendingUpdateRecord({
    updateData: bytesToBase64(new TextEncoder().encode("first payload")),
  });
  const first = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [sharedUpdate],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const second = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      {
        ...sharedUpdate,
        updateData: bytesToBase64(new TextEncoder().encode("second payload")),
      },
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const firstRecord = JSON.parse(
    first.plan.request.outgoingUpdates[0]?.encryptedData ?? "{}",
  ) as ContentRecordFields;
  const secondRecord = JSON.parse(
    second.plan.request.outgoingUpdates[0]?.encryptedData ?? "{}",
  ) as ContentRecordFields;

  expect(firstRecord.contentRecordId).toBe(sharedUpdate.id);
  expect(secondRecord.contentRecordId).toBe(sharedUpdate.id);
  expect(firstRecord.nonceDomainHash).toBe(secondRecord.nonceDomainHash);
  expect(firstRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(secondRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(firstRecord.iv).not.toBe(secondRecord.iv);
  expect(firstRecord.ciphertext).not.toBe(secondRecord.ciphertext);
});

test("decryptDocumentSyncUpdates verifies and decrypts content records", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        updateData: bytesToBase64(new TextEncoder().encode("incoming update")),
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);

  const decrypted = await decryptDocumentSyncUpdates({
    contentKey,
    contentKeyEpoch: materialized.plan.contentKeyEpoch,
    documentId: materialized.plan.documentId,
    organizationId: materialized.plan.organizationId,
    updates: response.updates,
  });

  expect(decrypted).toHaveLength(1);
  expect(decrypted[0]?.id).toBe("550e8400-e29b-41d4-a716-446655440444");
  expect(new TextDecoder().decode(decrypted[0]?.updateData)).toBe(
    "incoming update",
  );

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: update.encryptedData.replace(
          "tearleads.document.loro-update",
          "tearleads.document.loro-update.invalid",
        ),
      })),
    }),
  ).rejects.toThrow("format is invalid");

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: JSON.stringify({
          ...(JSON.parse(update.encryptedData) as Record<string, unknown>),
          version: 2,
        }),
      })),
    }),
  ).rejects.toThrow(
    "Document encrypted update version 2 is invalid; expected 1",
  );
});

test("persistedDocumentSyncStateFromResponse verifies accepted writes and returned write headers", async () => {
  const { author, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const plan = materialized.plan;
  const response = await createSyncResponse(plan);
  const writerPublicKeysByFingerprint = new Map([
    [author.signerKeyFingerprint, signingPublicKey],
  ]);

  await expect(
    persistedDocumentSyncStateFromResponse(plan, response, {
      writerPublicKeysByFingerprint,
    }),
  ).resolves.toEqual({
    documentId: plan.documentId,
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(plan.documentManifest),
  });

  const acceptedUpdate = plan.request.outgoingUpdates[0];
  if (!acceptedUpdate) {
    throw new Error("Expected outgoing update fixture.");
  }
  const staleAcceptedUpdate = await createSignedSyncResponseUpdate({
    accessManifestHash: await fixtureHash("stale-accepted-access-manifest"),
    author,
    id: acceptedUpdate.id,
    plan,
    targetHash: await fixtureHash("stale-accepted-target-hash"),
  });
  await expect(
    persistedDocumentSyncStateFromResponse(
      plan,
      await createSyncResponse(plan, {
        updates: [staleAcceptedUpdate],
      }),
      {
        writerPublicKeysByFingerprint,
      },
    ),
  ).rejects.toThrow("write header mismatch");

  const readOnlyMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const historicalUpdate = await createSignedSyncResponseUpdate({
    accessManifestHash: await fixtureHash("historical-access-manifest"),
    author,
    plan: readOnlyMaterialized.plan,
    targetHash: await fixtureHash("historical-target-hash"),
  });
  const historicalResponse = await createSyncResponse(
    readOnlyMaterialized.plan,
    {
      missingUpdateEpochs: ["current_epoch"],
      updates: [historicalUpdate],
    },
  );

  await expect(
    persistedDocumentSyncStateFromResponse(
      readOnlyMaterialized.plan,
      historicalResponse,
      {
        writerPublicKeysByFingerprint,
      },
    ),
  ).resolves.toEqual({
    documentId: readOnlyMaterialized.plan.documentId,
    contentKeyBundle: JSON.stringify(historicalResponse.contentKeyBundle),
    documentKekTargets: JSON.stringify(historicalResponse.documentKekTargets),
    documentManifestBundle: JSON.stringify(
      readOnlyMaterialized.plan.documentManifest,
    ),
  });

  await expect(
    persistedDocumentSyncStateFromResponse(plan, response),
  ).rejects.toThrow("writer public key verification is required");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, response, {
      writerPublicKeysByFingerprint: new Map(),
    }),
  ).rejects.toThrow("writer public key missing");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      acceptedOutgoingUpdateIds: ["550e8400-e29b-41d4-a716-446655440999"],
    }),
  ).rejects.toThrow("accepted update mismatch");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      updates: response.updates.map((update) => ({
        ...update,
        writeHeaderHash: "0".repeat(64),
      })),
    }),
  ).rejects.toThrow("write header hash mismatch");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: "tampered",
      })),
    }),
  ).rejects.toThrow("ciphertext hash mismatch");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      updates: response.updates.map((update) => ({
        ...update,
        writeHeader: {
          ...update.writeHeader,
          contentKeyEpoch: 0,
        },
      })),
    }),
  ).rejects.toThrow("write header.contentKeyEpoch must be a positive integer");
});

test("persistedDocumentSyncStateFromResponse rejects stale sync checkpoints", async () => {
  const { author, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    minLsn: "0/20",
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const plan = materialized.plan;
  const response = await createSyncResponse(plan, { commitLsn: "0/20" });
  const writerPublicKeysByFingerprint = new Map([
    [author.signerKeyFingerprint, signingPublicKey],
  ]);

  await expect(
    persistedDocumentSyncStateFromResponse(plan, response, {
      writerPublicKeysByFingerprint,
    }),
  ).resolves.toEqual({
    documentId: plan.documentId,
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(plan.documentManifest),
  });

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      commitLsn: "0/1F",
    }),
  ).rejects.toThrow("commit LSN is stale");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      commitLsn: null,
    }),
  ).rejects.toThrow("commit LSN is missing");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      commitLsn: "not-a-lsn",
    }),
  ).rejects.toThrow("commit LSN is invalid");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      missingUpdateEpochs: [],
    }),
  ).rejects.toThrow("missing update epochs mismatch");

  await expect(
    persistedDocumentSyncStateFromResponse(plan, {
      ...response,
      updates: response.updates.map((update) => ({
        ...update,
        accessEpoch: 2,
      })),
    }),
  ).rejects.toThrow("future access epoch");
});

test("syncRemoteDocument submits a signed sync request and persists the verified response", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return createSyncResponse({
          ...materialized.plan,
          documentId,
          request,
        });
      },
    },
    author,
    documentId: writerProjection.documentId,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerPublicKeysByFingerprint: new Map([
      [author.signerKeyFingerprint, signingPublicKey],
    ]),
  });

  expect(submittedRequests).toHaveLength(1);
  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(synced?.response.acceptedOutgoingUpdateIds).toEqual([
    "550e8400-e29b-41d4-a716-446655440444",
  ]);
  expect(
    new TextDecoder().decode(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("materialized update");
});

test("syncRemoteDocument replans once after a stale document sync conflict", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  const reportedErrors: string[] = [];
  let projectionRequestCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async (documentId) => {
        if (documentId !== writerProjection.documentId) {
          return null;
        }

        projectionRequestCount += 1;
        return writerProjection;
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle sync retries");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedRequests.push(request);

        if (submittedRequests.length === 1) {
          const message = `POST /documents/${documentId}/sync: 409 Conflict: authorizingContainerPaths[0][0] is stale`;
          return {
            message,
            ok: false,
            report: () => {
              reportedErrors.push(message);
            },
            status: 409,
          };
        }

        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          localVersionVector: null,
          pendingUpdates: [createPendingUpdateRecord()],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return {
          data: await createSyncResponse({
            ...materialized.plan,
            documentId,
            request,
          }),
          ok: true,
        };
      },
    },
    author,
    documentId: writerProjection.documentId,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerPublicKeysByFingerprint: new Map([
      [author.signerKeyFingerprint, signingPublicKey],
    ]),
  });

  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(projectionRequestCount).toBe(2);
  expect(submittedRequests).toHaveLength(2);
  expect(reportedErrors).toEqual([]);
  expect(
    Reflect.get(
      submittedRequests[1]?.authorizingContainerPaths?.[0]?.[0] ?? {},
      "manifestHash",
    ),
  ).toBe(projection.path[0]?.manifestHash);
});
