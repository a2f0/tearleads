import { expect, test } from "bun:test";
import {
  type AccessEventV2,
  CONTENT_RECORD_ENCRYPTION_SUITE_V2,
  computeAccessEventHash,
  computeWriteHeaderHash,
  encryptWithDek,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingV2CanonicalJson,
  toFingerprint,
  verifySignedAccessEvent,
  verifyWriteHeader,
  type WriteHeaderV2,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type DocumentV2CreateRequest,
  type DocumentV2LinkSetMutationRequest,
  type DocumentV2SyncRequest,
  isDocumentV2CreateRequest,
  isDocumentV2LinkSetMutationRequest,
  isDocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
  DocumentV2LinkSetMutationResponse,
  DocumentV2SyncResponse,
  DocumentV2WriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  buildDocumentV2CreatePlan,
  buildDocumentV2SyncPlan,
  buildMaterializedDocumentV2CreatePlan,
  buildMaterializedDocumentV2LinkSetMutationPlan,
  buildMaterializedDocumentV2SyncPlan,
  createRemoteDocumentV2,
  type DocumentV2CreateAuthor,
  type DocumentV2CreatePlan,
  decryptDocumentV2SyncUpdates,
  deriveDocumentV2CreateTargets,
  persistedDocumentV2CreateStateFromResponse,
  persistedDocumentV2LinkSetMutationStateFromResponse,
  persistedDocumentV2SyncStateFromResponse,
  relinkRemoteDocumentV2,
  syncRemoteDocumentV2,
  unwrapContainerV2KekPath,
  unwrapDocumentV2ContentKeyTarget,
} from "./documentV2Runtime";

async function fixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`document-v2:${label}`));
}

async function createProjection(): Promise<ContainerV2WriterProjectionResponse> {
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
  projection: ContainerV2WriterProjectionResponse;
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
  baseProjection: ContainerV2WriterProjectionResponse;
  rootContainerKek: Uint8Array;
}): Promise<{
  projection: ContainerV2WriterProjectionResponse;
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
  author: DocumentV2CreateAuthor;
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

function createResponse(plan: DocumentV2CreatePlan): DocumentV2CreateResponse {
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
  request: DocumentV2CreateRequest,
): Promise<DocumentV2CreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const eventHash = await computeAccessEventHash(
    request.event as unknown as AccessEventV2,
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
        version: 2,
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
  request: DocumentV2LinkSetMutationRequest,
): Promise<DocumentV2LinkSetMutationResponse> {
  const body = request.body as Record<string, unknown>;
  const manifest = request.manifest as Record<string, unknown>;
  const event = request.event as unknown as AccessEventV2;
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
        version: 2,
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
  projection: ContainerV2WriterProjectionResponse,
): ReturnType<typeof deriveDocumentV2CreateTargets>[number] {
  const target = deriveDocumentV2CreateTargets(projection)[0];
  if (!target) {
    throw new Error("Expected test projection to derive a document target");
  }
  return target;
}

test("buildDocumentV2CreatePlan signs an initial document link manifest from a container projection", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentV2CreatePlan({
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

  expect(isDocumentV2CreateRequest(plan.request)).toBe(true);
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
    body: plan.body as unknown as KeyingV2CanonicalJson,
    event: plan.event as AccessEventV2,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
});

test("buildDocumentV2CreatePlan rejects missing or stale content-key target envelopes", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);

  await expect(
    buildDocumentV2CreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-1",
      targetEnvelopes: [],
    }),
  ).rejects.toThrow("missing");

  await expect(
    buildDocumentV2CreatePlan({
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

test("deriveDocumentV2CreateTargets uses the leaf projection manifest and KEK", async () => {
  const projection = await createProjection();
  const currentManifest = projection.path[0];
  const currentKek = projection.containerKeks[0];
  if (!currentManifest || !currentKek) {
    throw new Error("Expected test projection to include current V2 state");
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

test("unwrapContainerV2KekPath follows parent KEK edges to the leaf", async () => {
  const {
    childContainerKek,
    childContainerKeyEpochId,
    projection,
    rootContainerKek,
    rootContainerKeyEpochId,
    secretKey,
  } = await createWrappedProjection();
  const unwrapped = await unwrapContainerV2KekPath({
    projection,
    secretKey,
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
    unwrapContainerV2KekPath({
      projection: {
        ...projection,
        containerKeks: [childKek],
      },
      secretKey,
    }),
  ).rejects.toThrow("inconsistent");

  await expect(
    unwrapContainerV2KekPath({
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
    }),
  ).rejects.toThrow("could not be unwrapped");
});

test("buildMaterializedDocumentV2CreatePlan wraps the content key to the target container KEK", async () => {
  const { author } = await createAuthor();
  const { childContainerKek, projection, secretKey } =
    await createWrappedProjection();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const materialized = await buildMaterializedDocumentV2CreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-materialized",
    eventId: "event-materialized",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
  });
  const [targetEnvelope] = materialized.plan.request.contentKeyBundle.targets;
  if (!targetEnvelope) {
    throw new Error("Expected a materialized content-key target");
  }
  const unwrappedContentKey = await unwrapDocumentV2ContentKeyTarget({
    containerKek: childContainerKek,
    envelope: targetEnvelope,
  });

  expect(Array.from(materialized.contentKey)).toEqual(Array.from(contentKey));
  expect(Array.from(unwrappedContentKey)).toEqual(Array.from(contentKey));
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
  expect(isDocumentV2CreateRequest(materialized.plan.request)).toBe(true);
});

test("createRemoteDocumentV2 submits the materialized request and persists the verified response", async () => {
  const { author } = await createAuthor();
  const { projection, secretKey } = await createWrappedProjection();
  const submittedRequests: DocumentV2CreateRequest[] = [];
  const created = await createRemoteDocumentV2({
    apiClient: {
      createDocumentV2: async (request) => {
        submittedRequests.push(request);
        return createResponseFromRequest(request);
      },
      getContainerV2WriterProjection: async (containerId) =>
        containerId === projection.containerId ? projection : null,
    },
    author,
    containerId: projection.containerId,
    documentId: "document-remote",
    eventId: "event-remote",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
  });

  expect(created?.documentId).toBe("document-remote");
  if (!created) {
    throw new Error("Expected remote document create result");
  }
  expect(submittedRequests).toHaveLength(1);
  expect(created.persistedState).toEqual({
    documentId: "document-remote",
    v2ContentKeyBundle: JSON.stringify(created.response.contentKeyBundle),
    v2DocumentKekTargets: JSON.stringify(created.response.documentKekTargets),
    v2DocumentManifestBundle: JSON.stringify(created.response.accessManifest),
  });
});

test("persistedDocumentV2CreateStateFromResponse stores verified V2 create bundles", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentV2CreatePlan({
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

  expect(persistedDocumentV2CreateStateFromResponse(plan, response)).toEqual({
    documentId: "document-1",
    v2ContentKeyBundle: JSON.stringify(response.contentKeyBundle),
    v2DocumentKekTargets: JSON.stringify(response.documentKekTargets),
    v2DocumentManifestBundle: JSON.stringify(response.accessManifest),
  });

  expect(() =>
    persistedDocumentV2CreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targetHash: tamperedTargetHash,
      },
    }),
  ).toThrow("target hash mismatch");

  expect(() =>
    persistedDocumentV2CreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targets: [],
      },
    }),
  ).toThrow("content-key targets mismatch");
});

test("buildMaterializedDocumentV2LinkSetMutationPlan adds links without rotating and unlinks with a rotated content key", async () => {
  const { author } = await createAuthor();
  const { childContainerKek, projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection, siblingContainerKek } =
    await createSiblingProjection({
      baseProjection: projection,
      rootContainerKek,
    });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const created = await buildMaterializedDocumentV2CreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-link-set",
    targetSecretKey: secretKey,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentV2WriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };

  const linked = await buildMaterializedDocumentV2LinkSetMutationPlan({
    author,
    operation: "link",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    writerProjection,
  });
  expect(isDocumentV2LinkSetMutationRequest(linked.plan.request)).toBe(true);
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
    unwrapDocumentV2ContentKeyTarget({
      containerKek: childContainerKek,
      envelope: siblingEnvelope,
    }),
  ).rejects.toThrow();
  const siblingContentKey = await unwrapDocumentV2ContentKeyTarget({
    containerKek: siblingContainerKek,
    envelope: siblingEnvelope,
  });
  expect(Array.from(siblingContentKey)).toEqual(Array.from(contentKey));

  const linkResponse = await createLinkSetResponseFromRequest(
    writerProjection.documentId,
    linked.plan.request,
  );
  const rotatedContentKey = crypto.getRandomValues(new Uint8Array(32));
  const unlinked = await buildMaterializedDocumentV2LinkSetMutationPlan({
    author,
    contentKey: rotatedContentKey,
    operation: "unlink",
    signedAt: "2026-04-27T00:00:01.000Z",
    targetContainerProjection: projection,
    targetSecretKey: secretKey,
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
  const remainingContentKey = await unwrapDocumentV2ContentKeyTarget({
    containerKek: siblingContainerKek,
    envelope: remainingEnvelope,
  });
  expect(Array.from(remainingContentKey)).toEqual(
    Array.from(rotatedContentKey),
  );
});

test("buildMaterializedDocumentV2LinkSetMutationPlan names inaccessible remaining KEKs during unlink", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection, siblingContainerKeyEpochId } =
    await createSiblingProjection({
      baseProjection: projection,
      rootContainerKek,
    });
  const created = await buildMaterializedDocumentV2CreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-link-set-missing-kek",
    targetSecretKey: secretKey,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentV2WriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const linked = await buildMaterializedDocumentV2LinkSetMutationPlan({
    author,
    operation: "link",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    writerProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    writerProjection.documentId,
    linked.plan.request,
  );
  const inaccessibleSiblingProjection: ContainerV2WriterProjectionResponse = {
    ...siblingProjection,
    containerKeks: siblingProjection.containerKeks.map((kek, index) =>
      index === siblingProjection.containerKeks.length - 1
        ? { ...kek, wraps: [] }
        : kek,
    ),
  };

  await expect(
    buildMaterializedDocumentV2LinkSetMutationPlan({
      author,
      operation: "unlink",
      targetContainerProjection: projection,
      targetSecretKey: secretKey,
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

test("relinkRemoteDocumentV2 submits a verified signed link-set mutation", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection } = await createSiblingProjection({
    baseProjection: projection,
    rootContainerKek,
  });
  const created = await buildMaterializedDocumentV2CreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-remote-link",
    targetSecretKey: secretKey,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentV2WriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const submittedRequests: DocumentV2LinkSetMutationRequest[] = [];

  const linked = await relinkRemoteDocumentV2({
    apiClient: {
      getContainerV2WriterProjection: async (containerId) =>
        containerId === siblingProjection.containerId
          ? siblingProjection
          : null,
      getDocumentV2WriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      linkDocumentV2: async (documentId, request) => {
        submittedRequests.push(request);
        return createLinkSetResponseFromRequest(documentId, request);
      },
      unlinkDocumentV2: async () => {
        throw new Error("Unexpected unlink call");
      },
    },
    author,
    documentId: writerProjection.documentId,
    operation: "link",
    targetContainerId: siblingProjection.containerId,
    targetSecretKey: secretKey,
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
    persistedDocumentV2LinkSetMutationStateFromResponse(
      linked.plan,
      linked.response,
    ),
  ).toEqual(linked.persistedState);
});

async function createSyncFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const createPlan = await buildDocumentV2CreatePlan({
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
  const { childContainerKek, projection, secretKey } =
    await createWrappedProjection();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const materializedCreate = await buildMaterializedDocumentV2CreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "550e8400-e29b-41d4-a716-446655440010",
    eventId: "event-materialized-sync",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentV2WriterProjectionResponse = {
    documentId: response.id,
    documentManifest: response.accessManifest,
    documentKekTargets: response.documentKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    authorizingContainerPaths: [projection],
  };

  return {
    author,
    childContainerKek,
    contentKey,
    createResponse: response,
    projection,
    secretKey,
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
  projection: ContainerV2WriterProjectionResponse,
): Record<string, unknown>[] {
  return projection.path.map(
    (bundle) => bundle as unknown as Record<string, unknown>,
  );
}

async function createSyncResponse(
  plan: Awaited<ReturnType<typeof buildDocumentV2SyncPlan>>,
  overrides: Partial<DocumentV2SyncResponse> = {},
): Promise<DocumentV2SyncResponse> {
  const updates = await Promise.all(
    plan.request.outgoingUpdates.map(async (update) => {
      const writeHeader = update.writeHeader as unknown as WriteHeaderV2;
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

test("buildDocumentV2SyncPlan signs document write headers with the current V2 access boundary", async () => {
  const { author, createResponse, projection, signingPublicKey } =
    await createSyncFixture();
  const plan = await buildDocumentV2SyncPlan({
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

  expect(isDocumentV2SyncRequest(plan.request)).toBe(true);
  expect(plan.request.documentManifest?.manifestHash).toBe(
    createResponse.accessManifest.manifestHash,
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
  const writeHeader = update.writeHeader as unknown as WriteHeaderV2;
  expect(writeHeader.objectKind).toBe("document");
  expect(writeHeader.objectId).toBe(plan.documentId);
  expect(writeHeader.organizationId).toBe(author.organizationId);
  expect(writeHeader.accessManifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(writeHeader.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(writeHeader.encryptionSuite).toBe(CONTENT_RECORD_ENCRYPTION_SUITE_V2);

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

test("buildDocumentV2SyncPlan omits write authorization proof fields for read-only probes", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentV2SyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    includeContentKeyBundle: true,
    localVersionVector: "{}",
  });

  expect(isDocumentV2SyncRequest(plan.request)).toBe(true);
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.documentManifest).toBeUndefined();
  expect(plan.request.authorizingContainerPaths).toBeUndefined();
  expect(plan.request.contentKeyBundle?.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
});

test("buildDocumentV2SyncPlan rejects duplicate V2 content record domains before signing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();
  const duplicateContentRecordId = "550e8400-e29b-41d4-a716-446655440333";

  await expect(
    buildDocumentV2SyncPlan({
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

test("buildMaterializedDocumentV2SyncPlan unwraps the V2 content key and encrypts pending updates", async () => {
  const { author, contentKey, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const plan = await buildMaterializedDocumentV2SyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        sourceVersionVector: "rotate-frontier",
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });

  expect(Array.from(plan.contentKey)).toEqual(Array.from(contentKey));
  expect(isDocumentV2SyncRequest(plan.plan.request)).toBe(true);
  const update = plan.plan.request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected materialized V2 outgoing update");
  }
  expect(update.checkpointKind).toBe("rotate_baseline");
  expect(update.sourceVersionVector).toBe("rotate-frontier");
  expect(update.encryptedData).toContain(
    "tearleads.document-v2.loro-update.v1",
  );
  expect(update.encryptedData).not.toContain("materialized update");

  const writeHeader = update.writeHeader as unknown as WriteHeaderV2;
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

test("decryptDocumentV2SyncUpdates verifies and decrypts V2 content records", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentV2SyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        updateData: bytesToBase64(new TextEncoder().encode("incoming update")),
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);

  const decrypted = await decryptDocumentV2SyncUpdates({
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
    decryptDocumentV2SyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: update.encryptedData.replace(
          "tearleads.document-v2.loro-update.v1",
          "tearleads.document-v2.loro-update.invalid",
        ),
      })),
    }),
  ).rejects.toThrow("format is invalid");
});

test("persistedDocumentV2SyncStateFromResponse verifies accepted writes and returned write headers", async () => {
  const { author, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentV2SyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const plan = materialized.plan;
  const response = await createSyncResponse(plan);

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, response, {
      writerPublicKeysByFingerprint: new Map([
        [author.signerKeyFingerprint, signingPublicKey],
      ]),
    }),
  ).resolves.toEqual({
    documentId: plan.documentId,
    v2ContentKeyBundle: JSON.stringify(response.contentKeyBundle),
    v2DocumentKekTargets: JSON.stringify(response.documentKekTargets),
    v2DocumentManifestBundle: JSON.stringify(plan.documentManifest),
  });

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, response, {
      writerPublicKeysByFingerprint: new Map(),
    }),
  ).rejects.toThrow("writer public key missing");

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      acceptedOutgoingUpdateIds: ["550e8400-e29b-41d4-a716-446655440999"],
    }),
  ).rejects.toThrow("accepted update mismatch");

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      updates: response.updates.map((update) => ({
        ...update,
        writeHeaderHash: "0".repeat(64),
      })),
    }),
  ).rejects.toThrow("write header hash mismatch");

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: "tampered",
      })),
    }),
  ).rejects.toThrow("ciphertext hash mismatch");
});

test("persistedDocumentV2SyncStateFromResponse rejects stale sync checkpoints", async () => {
  const { author, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentV2SyncPlan({
    author,
    localVersionVector: null,
    minLsn: "0/20",
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const plan = materialized.plan;
  const response = await createSyncResponse(plan, { commitLsn: "0/20" });
  const writerPublicKeysByFingerprint = new Map([
    [author.signerKeyFingerprint, signingPublicKey],
  ]);

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, response, {
      writerPublicKeysByFingerprint,
    }),
  ).resolves.toEqual({
    documentId: plan.documentId,
    v2ContentKeyBundle: JSON.stringify(response.contentKeyBundle),
    v2DocumentKekTargets: JSON.stringify(response.documentKekTargets),
    v2DocumentManifestBundle: JSON.stringify(plan.documentManifest),
  });

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      commitLsn: "0/1F",
    }),
  ).rejects.toThrow("commit LSN is stale");

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      commitLsn: null,
    }),
  ).rejects.toThrow("commit LSN is missing");

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      commitLsn: "not-a-lsn",
    }),
  ).rejects.toThrow("commit LSN is invalid");

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      missingUpdateEpochs: [],
    }),
  ).rejects.toThrow("missing update epochs mismatch");

  await expect(
    persistedDocumentV2SyncStateFromResponse(plan, {
      ...response,
      updates: response.updates.map((update) => ({
        ...update,
        accessEpoch: 2,
      })),
    }),
  ).rejects.toThrow("future access epoch");
});

test("syncRemoteDocumentV2 submits a signed V2 sync request and persists the verified response", async () => {
  const { author, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const submittedRequests: DocumentV2SyncRequest[] = [];
  const synced = await syncRemoteDocumentV2({
    apiClient: {
      getDocumentV2WriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      syncDocumentV2: async (documentId, request) => {
        submittedRequests.push(request);
        const materialized = await buildMaterializedDocumentV2SyncPlan({
          author,
          localVersionVector: null,
          pendingUpdates: [],
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
