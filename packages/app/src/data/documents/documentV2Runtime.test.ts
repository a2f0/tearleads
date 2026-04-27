import { expect, test } from "bun:test";
import {
  type AccessEventV2,
  computeAccessEventHash,
  encryptWithDek,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingV2CanonicalJson,
  toFingerprint,
  verifySignedAccessEvent,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type DocumentV2CreateRequest,
  isDocumentV2CreateRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
} from "@tearleads/validators/response";
import {
  buildDocumentV2CreatePlan,
  buildMaterializedDocumentV2CreatePlan,
  createRemoteDocumentV2,
  type DocumentV2CreateAuthor,
  type DocumentV2CreatePlan,
  deriveDocumentV2CreateTargets,
  persistedDocumentV2CreateStateFromResponse,
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
