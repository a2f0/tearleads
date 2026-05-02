import { expect, test } from "bun:test";
import {
  type AccessEvent,
  type ContainerAccessLevel,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerDirectGrant,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  decryptWithDek,
  deriveContainerAccessManifest,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  signAccessEvent,
  toFingerprint,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { unwrapContainerKekPath } from "../documents/documentRuntime";
import {
  buildContainerCreatePlan,
  buildMaterializedContainerCreatePlan,
  type ContainerMutationAuthor,
  createRemoteContainer,
  shareRemoteContainer,
} from "./containerRuntime";

const SIGNED_AT = "2026-04-28T12:00:00.000Z";

interface DeepNonCanonicalRecord {
  next?: DeepNonCanonicalRecord;
  notJson?: undefined;
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

async function createAuthor(input?: {
  organizationId?: string;
  userId?: string;
}): Promise<{
  author: ContainerMutationAuthor;
  signingPublicKey: Uint8Array;
}> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  return {
    author: {
      organizationId: input?.organizationId ?? "organization-1",
      signerDeviceId: "test-device-1",
      signerKeyFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      signerUserId: input?.userId ?? "user-1",
    },
    signingPublicKey: signingKeyPair.signingPublicKey,
  };
}

async function signContainerEvent(input: {
  body: ContainerCreateAccessEventBody;
  eventId: string;
  objectId: string;
  organizationId: string;
  signer: ContainerMutationAuthor;
}): Promise<{
  event: AccessEvent;
  eventHash: string;
}> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: input.eventId,
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.signerUserId,
      signerDeviceId: input.signer.signerDeviceId,
      signerKeyFingerprint: input.signer.signerKeyFingerprint,
      signedAt: SIGNED_AT,
    },
    input.signer.signerPrivateKey,
  );

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function createContainerManifestFixture(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKeyEpochId: string;
  directGrants: readonly ContainerDirectGrant[];
  eventId: string;
  metadataDocumentId: string;
  organizationId: string;
  referencedPrincipalHeads?: ContainerAccessManifestState["referencedPrincipalHeads"];
}): Promise<VerifiedContainerAccessManifest> {
  const referencedPrincipalHeads = input.referencedPrincipalHeads ?? [];
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: [...referencedPrincipalHeads],
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    eventId: input.eventId,
    objectId: input.containerId,
    organizationId: input.organizationId,
    signer: input.author,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.containerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: [...referencedPrincipalHeads],
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const verified = await verifyContainerAccessManifest({
    event: {
      event,
      body: body as unknown as KeyingCanonicalJson,
      eventHash,
    } as VerifiedAccessEvent,
    expectedManifestHash: manifestHash,
    manifest,
    parentContainerPath: [],
    previousManifest: null,
    principalPolicies: [],
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

async function createUserContainerWrap(input: {
  containerKeyEpochId: string;
  containerKek: Uint8Array;
  publicKey: Uint8Array;
  recipientKeyEpochId: string;
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
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
    wrapManifestHash: input.wrapManifestHash,
  };
}

async function createParentProjection(input?: {
  existingUserRecipient?: {
    accessLevel: ContainerAccessLevel;
    publicKey: Uint8Array;
    recipientKeyEpochId: string;
    userId: string;
  };
}): Promise<{
  author: ContainerMutationAuthor;
  encapsulationPublicKey: Uint8Array;
  parentContainerKek: Uint8Array;
  parentKekState: VerifiedContainerKekState;
  projection: ContainerWriterProjectionResponse;
  secretKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}> {
  const userId = "user-1";
  const organizationId = "organization-1";
  const containerId = "parent-container";
  const containerKeyEpochId = "parent-container-key-epoch-1";
  const { author, signingPublicKey } = await createAuthor({
    organizationId,
    userId,
  });
  const parentManifest = await createContainerManifestFixture({
    author,
    containerId,
    containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: userId,
        accessLevel: "admin",
      },
      ...(input?.existingUserRecipient
        ? [
            {
              subjectType: "user" as const,
              subjectId: input.existingUserRecipient.userId,
              accessLevel: input.existingUserRecipient.accessLevel,
            },
          ]
        : []),
    ],
    eventId: "parent-container-event-1",
    metadataDocumentId: "parent-container-metadata-document",
    organizationId,
  });
  const keyPair = generateKemSeedAndKeyPair();
  const parentContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const recipientKeyFingerprint = await toFingerprint(keyPair.publicKey);
  const recipientKeyEpochId = `user:${userId}:encapsulation:${recipientKeyFingerprint}`;
  const wrap = await createUserContainerWrap({
    containerKeyEpochId,
    containerKek: parentContainerKek,
    publicKey: keyPair.publicKey,
    recipientKeyEpochId,
    userId,
    wrapManifestHash: parentManifest.manifestHash,
  });
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: parentManifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: parentManifest.event.eventHash,
    createdByManifestHash: parentManifest.manifestHash,
  };
  const recipientTargets: ContainerKekRecipientTarget[] = [
    {
      recipientKind: "user",
      recipientId: userId,
      recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    },
  ];
  const wraps = [wrap];
  if (input?.existingUserRecipient) {
    const existingWrap = await createUserContainerWrap({
      containerKeyEpochId,
      containerKek: parentContainerKek,
      publicKey: input.existingUserRecipient.publicKey,
      recipientKeyEpochId: input.existingUserRecipient.recipientKeyEpochId,
      userId: input.existingUserRecipient.userId,
      wrapManifestHash: parentManifest.manifestHash,
    });
    recipientTargets.push({
      recipientKind: "user",
      recipientId: input.existingUserRecipient.userId,
      recipientKeyEpochId: input.existingUserRecipient.recipientKeyEpochId,
      recipientKeyFingerprint: existingWrap.recipientKeyFingerprint,
    });
    wraps.push(existingWrap);
  }
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const parentKekState = {
    containerId,
    accessManifestHash: parentManifest.manifestHash,
    containerKeyEpochId,
    containerKeyEpoch: 1,
    keyEpoch,
    keyEpochHash,
    keyTargetHash:
      await computeContainerKekRecipientTargetHash(recipientTargets),
    parentContainerKeyEpochId: null,
    recipientTargets,
    wraps,
  } as unknown as VerifiedContainerKekState;

  return {
    author,
    encapsulationPublicKey: keyPair.publicKey,
    parentContainerKek,
    parentKekState,
    projection: {
      containerId,
      organizationId,
      path: [
        parentManifest as unknown as ContainerWriterProjectionResponse["path"][number],
      ],
      containerKeks: [
        parentKekState as unknown as ContainerWriterProjectionResponse["containerKeks"][number],
      ],
    },
    secretKey: keyPair.secretKey,
    signingPublicKey,
    userId,
  };
}

function createParentProjectionUserKeyResolver(
  parent: Awaited<ReturnType<typeof createParentProjection>>,
) {
  return async (userId: string) =>
    userId === parent.userId
      ? {
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        }
      : null;
}

async function createMutationResponseFromRequest(
  request: ContainerMutationRequest,
): Promise<ContainerMutationResponse> {
  const event = request.event as unknown as AccessEvent;
  const body = request.body as ContainerCreateAccessEventBody;
  const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;

  return {
    containerId: event.objectId,
    organizationId: event.organizationId,
    parentId: body.parentContainerId,
    manifestHead: {
      epoch: 1,
      manifestHash: request.expectedManifestHash,
    },
    accessManifest: {
      event: {
        event: request.event,
        body: request.body as Record<string, unknown>,
        eventHash: await computeAccessEventHash(event),
      },
      manifest: request.manifest,
      manifestHash: request.expectedManifestHash,
      state: {},
    },
    containerKek: {
      containerId: event.objectId,
      accessManifestHash: request.expectedManifestHash,
      containerKeyEpochId: keyEpoch.id,
      containerKeyEpoch: keyEpoch.keyEpoch,
      keyEpoch: request.keyEpoch,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyTargetHash: "test-key-target-hash",
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      recipientTargets: [{}],
      wraps: request.wraps,
    },
    referencedPrincipalHeads: [],
  };
}

test("buildMaterializedContainerCreatePlan signs a child create and wraps the child KEK to the parent KEK only", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const materialized = await buildMaterializedContainerCreatePlan({
    author,
    containerId: "child-container",
    containerKey,
    containerKeyEpochId: "child-container-key-epoch-1",
    eventId: "child-container-event-1",
    metadataDocumentId: "child-container-metadata-document",
    parentProjection: parent.projection,
    parentSecretKey: parent.secretKey,
    signedAt: SIGNED_AT,
  });
  const { plan } = materialized;
  const parentManifestHash = parent.projection.path[0]?.manifestHash;
  if (!parentManifestHash) {
    throw new Error("Expected parent projection manifest");
  }

  expect(isContainerMutationRequest(plan.request)).toBe(true);
  expect(plan.body).toEqual({
    eventType: "container.create",
    parentContainerId: parent.projection.containerId,
    parentManifestHash,
    metadataDocumentId: "child-container-metadata-document",
    containerKeyEpochId: "child-container-key-epoch-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  });
  expect(plan.request.userRecipientKeys).toEqual([]);
  expect(plan.request.principalPolicies).toEqual([]);
  expect(
    plan.request.parentContainerPath?.map((bundle) => bundle.manifestHash),
  ).toEqual(parent.projection.path.map((bundle) => bundle.manifestHash));
  expect(plan.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: parent.parentKekState.containerId,
      recipientKeyEpochId: parent.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: parent.parentKekState.keyEpochHash,
    },
  ]);
  expect(plan.wraps).toHaveLength(1);
  expect(plan.wraps[0]?.recipientKind).toBe("container");

  const verifiedEvent = await verifySignedAccessEvent({
    body: plan.body as unknown as KeyingCanonicalJson,
    event: plan.event,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }
  const verifiedManifest = await verifyContainerAccessManifest({
    event: verifiedEvent.value,
    expectedManifestHash: plan.manifestHash,
    manifest: plan.manifest,
    parentContainerPath: [
      parent.projection.path[0] as unknown as VerifiedContainerAccessManifest,
    ],
  });
  expect(verifiedManifest.ok).toBe(true);
  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }
  const verifiedKek = await verifyContainerKekState({
    containerManifest: verifiedManifest.value,
    keyEpoch: plan.keyEpoch,
    parentKekState: parent.parentKekState,
    wraps: plan.wraps,
  });
  expect(verifiedKek.ok).toBe(true);
  if (!verifiedKek.ok) {
    throw verifiedKek.error;
  }

  const [wrap] = plan.wraps;
  if (!wrap) {
    throw new Error("Expected child container KEK wrap");
  }
  const unwrappedChildKek = await decryptWithDek(
    {
      iv: base64ToBytes(wrap.kemCipherText),
      ciphertext: base64ToBytes(wrap.wrappedKey),
    },
    parent.parentContainerKek,
  );
  expect(Array.from(unwrappedChildKek)).toEqual(Array.from(containerKey));
  expect(verifiedKek.value.keyTargetHash).toBe(plan.keyTargetHash);
  expect(verifiedKek.value.keyEpochHash).toBe(plan.keyEpochHash);
});

test("buildContainerCreatePlan rejects stale parent projections and wrong organization authors", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({ organizationId: "other-org" });

  await expect(
    buildContainerCreatePlan({
      author,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentKekMaterial: parent.parentContainerKek,
      parentProjection: parent.projection,
    }),
  ).rejects.toThrow("organization");

  const validAuthor = (
    await createAuthor({ organizationId: parent.projection.organizationId })
  ).author;
  await expect(
    buildContainerCreatePlan({
      author: validAuthor,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentKekMaterial: parent.parentContainerKek,
      parentProjection: {
        ...parent.projection,
        containerKeks: [
          {
            ...parent.projection.containerKeks[0],
            accessManifestHash: "stale-parent-manifest-hash",
          } as ContainerWriterProjectionResponse["containerKeks"][number],
        ],
      },
    }),
  ).rejects.toThrow("stale");

  await expect(
    buildContainerCreatePlan({
      author: validAuthor,
      containerKey: crypto.getRandomValues(new Uint8Array(16)),
      parentKekMaterial: parent.parentContainerKek,
      parentProjection: parent.projection,
    }),
  ).rejects.toThrow("KEK material");
});

test("buildMaterializedContainerCreatePlan rejects non-canonical parent path records before request construction", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });

  await expect(
    buildMaterializedContainerCreatePlan({
      author,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentProjection: {
        ...parent.projection,
        path: parent.projection.path.map((bundle) => ({
          ...bundle,
          state: {
            ...bundle.state,
            wouldBeDroppedByJson: undefined,
          },
        })),
      },
      parentSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("must be canonical JSON");
});

test("buildMaterializedContainerCreatePlan rejects deeply nested non-canonical parent records without overflowing", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });

  await expect(
    buildMaterializedContainerCreatePlan({
      author,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentProjection: {
        ...parent.projection,
        path: parent.projection.path.map((bundle) => ({
          ...bundle,
          event: {
            ...bundle.event,
            body: createDeepNonCanonicalRecord(20_000),
          },
        })),
      },
      parentSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("must be canonical JSON");
});

test("shareRemoteContainer rejects malformed projected container state before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  let shareCalled = false;

  await expect(
    shareRemoteContainer({
      accessLevel: "read",
      apiClient: {
        getContainerWriterProjection: async () => ({
          ...parent.projection,
          path: parent.projection.path.map((bundle) => ({
            ...bundle,
            state: {
              ...bundle.state,
              directGrants: "not-grants",
            },
          })),
        }),
        shareContainer: async () => {
          shareCalled = true;
          throw new Error("Unexpected share call");
        },
      },
      author,
      containerId: parent.projection.containerId,
      recipientEncapsulationPublicKey: recipientKeyPair.publicKey,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("directGrants must be an array");
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer includes existing direct user recipient keys", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainer({
    accessLevel: "write",
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        const event = request.event as unknown as AccessEvent;
        const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;
        const previousKek = parent.projection.containerKeks[0];
        if (!previousKek) {
          throw new Error("Expected parent projection KEK");
        }

        return {
          containerId: parent.projection.containerId,
          organizationId: parent.projection.organizationId,
          parentId: null,
          manifestHead: {
            epoch: 2,
            manifestHash: request.expectedManifestHash,
          },
          accessManifest: {
            event: {
              event: request.event,
              body: request.body,
              eventHash: await computeAccessEventHash(event),
            },
            manifest: request.manifest,
            manifestHash: request.expectedManifestHash,
            state: {},
          },
          containerKek: {
            ...previousKek,
            accessManifestHash: request.expectedManifestHash,
            keyEpoch: request.keyEpoch,
            keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
            wraps: request.wraps,
          },
          referencedPrincipalHeads: [],
        };
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientEncapsulationPublicKey: recipientKeyPair.publicKey,
    recipientUserId: "user-2",
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

  expect(shared).not.toBeNull();
  if (!shared) {
    throw new Error("Expected share result");
  }
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted share request");
  }
  const submittedUserRecipientKeys =
    submittedRequest.userRecipientKeys as unknown as ContainerUserRecipientKey[];
  expect(submittedUserRecipientKeys.map((key) => key.userId)).toEqual([
    "user-1",
    "user-2",
  ]);

  const verifiedEvent = await verifySignedAccessEvent({
    body: shared.plan.body as unknown as KeyingCanonicalJson,
    event: shared.plan.event,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  const previousManifest = parent.projection
    .path[0] as unknown as VerifiedContainerAccessManifest;
  const verifiedManifest = await verifyContainerAccessManifest({
    event: verifiedEvent.value,
    expectedManifestHash: shared.plan.manifestHash,
    manifest: shared.plan.manifest,
    previousManifest,
    previousContainerPath: [previousManifest],
  });
  expect(verifiedManifest.ok).toBe(true);
  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  const verifiedKek = await verifyContainerKekState({
    containerManifest: verifiedManifest.value,
    containerManifestHistory: [previousManifest],
    keyEpoch: shared.plan.keyEpoch,
    userRecipientKeys: submittedUserRecipientKeys,
    wraps: shared.plan.wraps,
  });
  expect(verifiedKek.ok).toBe(true);
  if (!verifiedKek.ok) {
    throw verifiedKek.error;
  }
  const ownerUserRecipientKey = submittedUserRecipientKeys[0];
  const peerUserRecipientKey = submittedUserRecipientKeys[1];
  if (!ownerUserRecipientKey || !peerUserRecipientKey) {
    throw new Error("Expected owner and peer recipient keys");
  }
  expect(verifiedKek.value.recipientTargets).toEqual([
    {
      recipientKind: "user",
      recipientId: "user-1",
      recipientKeyEpochId: ownerUserRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: ownerUserRecipientKey.recipientKeyFingerprint,
    },
    {
      recipientKind: "user",
      recipientId: "user-2",
      recipientKeyEpochId: peerUserRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: peerUserRecipientKey.recipientKeyFingerprint,
    },
  ]);
});

test("shareRemoteContainer replaces stale wraps when re-sharing a user", async () => {
  const existingUserId = "user-2";
  const oldRecipientKeyPair = generateKemSeedAndKeyPair();
  const newRecipientKeyPair = generateKemSeedAndKeyPair();
  const oldRecipientKeyEpochId = `user:${existingUserId}:encapsulation:${await toFingerprint(oldRecipientKeyPair.publicKey)}`;
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "read",
      publicKey: oldRecipientKeyPair.publicKey,
      recipientKeyEpochId: oldRecipientKeyEpochId,
      userId: existingUserId,
    },
  });
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const previousKek = parent.projection.containerKeks[0];
  if (!previousKek) {
    throw new Error("Expected parent projection KEK");
  }
  const existingWrap = previousKek.wraps.find(
    (wrap) =>
      Reflect.get(wrap, "recipientKind") === "user" &&
      Reflect.get(wrap, "recipientId") === existingUserId,
  );
  if (!existingWrap) {
    throw new Error("Expected existing user wrap");
  }
  const existingRecipientTarget = previousKek.recipientTargets.find(
    (target) =>
      Reflect.get(target, "recipientKind") === "user" &&
      Reflect.get(target, "recipientId") === existingUserId,
  );
  if (!existingRecipientTarget) {
    throw new Error("Expected existing user recipient target");
  }
  const projectionWithExistingShare = parent.projection;
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainer({
    accessLevel: "write",
    apiClient: {
      getContainerWriterProjection: async () => projectionWithExistingShare,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientEncapsulationPublicKey: newRecipientKeyPair.publicKey,
    recipientUserId: existingUserId,
    resolveProjectionUserKey: async (userId) => {
      if (userId === parent.userId) {
        return {
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        };
      }
      if (userId === existingUserId) {
        return {
          encapsulationPublicKey: oldRecipientKeyPair.publicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        };
      }

      return null;
    },
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

  expect(shared).not.toBeNull();
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted share request");
  }
  const submittedWraps =
    submittedRequest.wraps as unknown as ContainerKeyWrap[];
  const existingUserWraps = submittedWraps.filter(
    (wrap) =>
      wrap.recipientKind === "user" && wrap.recipientId === existingUserId,
  );
  expect(existingUserWraps).toHaveLength(1);
  expect(existingUserWraps[0]?.recipientKeyEpochId).not.toBe(
    oldRecipientKeyEpochId,
  );
  expect(submittedWraps).not.toContainEqual(
    expect.objectContaining({
      recipientId: existingUserId,
      recipientKeyEpochId: oldRecipientKeyEpochId,
    }),
  );
  expect(submittedWraps).toHaveLength(previousKek.wraps.length);
});

test("unwrapContainerKekPath verifies signed projection events before unwrap", async () => {
  const parent = await createParentProjection();
  const tamperedProjection = structuredClone(parent.projection);
  const event = Reflect.get(tamperedProjection.path[0]?.event ?? {}, "event");
  if (!event || typeof event !== "object") {
    throw new Error("Expected projection event");
  }
  Reflect.set(event, "signature", bytesToBase64(new Uint8Array(64)));

  await expect(
    unwrapContainerKekPath({
      projection: tamperedProjection,
      resolveProjectionUserKey: async (userId) =>
        userId === parent.userId
          ? {
              encapsulationPublicKey: parent.encapsulationPublicKey,
              signingPublicKey: parent.signingPublicKey,
              userId,
            }
          : null,
      secretKey: parent.secretKey,
    }),
  ).rejects.toThrow("signature");
});

test("unwrapContainerKekPath rejects projection wraps not justified by the manifest", async () => {
  const parent = await createParentProjection();
  const attackerUserId = "attacker-user";
  const attackerKeyPair = generateKemSeedAndKeyPair();
  const attackerFingerprint = await toFingerprint(attackerKeyPair.publicKey);
  const attackerWrap = await createUserContainerWrap({
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    containerKek: parent.parentContainerKek,
    publicKey: attackerKeyPair.publicKey,
    recipientKeyEpochId: `user:${attackerUserId}:encapsulation:${attackerFingerprint}`,
    userId: attackerUserId,
    wrapManifestHash: parent.parentKekState.accessManifestHash,
  });
  const tamperedProjection = structuredClone(parent.projection);
  const kek = tamperedProjection.containerKeks[0];
  if (!kek) {
    throw new Error("Expected projection KEK");
  }
  kek.wraps = [...kek.wraps, attackerWrap];

  await expect(
    unwrapContainerKekPath({
      projection: tamperedProjection,
      resolveProjectionUserKey: async (userId) =>
        userId === parent.userId
          ? {
              encapsulationPublicKey: parent.encapsulationPublicKey,
              signingPublicKey: parent.signingPublicKey,
              userId,
            }
          : null,
      secretKey: parent.secretKey,
    }),
  ).rejects.toThrow("KEK verification failed");
});

test("unwrapContainerKekPath fails closed for managed-principal KEK projections", async () => {
  const parent = await createParentProjection();
  const groupHead = {
    principalType: "group" as const,
    principalId: "group-1",
    version: 1,
    keyEpoch: 1,
    stateHash: await toFingerprint(new TextEncoder().encode("group-state-1")),
    keyFingerprint: await toFingerprint(
      new TextEncoder().encode("group-key-1"),
    ),
  };
  const managedManifest = await createContainerManifestFixture({
    author: parent.author,
    containerId: parent.parentKekState.containerId,
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: parent.userId,
        accessLevel: "admin",
      },
      {
        subjectType: "group",
        subjectId: groupHead.principalId,
        accessLevel: "write",
      },
    ],
    eventId: "managed-parent-container-event-1",
    metadataDocumentId: "parent-container-metadata-document",
    organizationId: parent.projection.organizationId,
    referencedPrincipalHeads: [groupHead],
  });
  const managedProjection: ContainerWriterProjectionResponse = {
    ...parent.projection,
    path: [
      managedManifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
  };

  await expect(
    unwrapContainerKekPath({
      projection: managedProjection,
      resolveProjectionUserKey: async (userId) =>
        userId === parent.userId
          ? {
              encapsulationPublicKey: parent.encapsulationPublicKey,
              signingPublicKey: parent.signingPublicKey,
              userId,
            }
          : null,
      secretKey: parent.secretKey,
    }),
  ).rejects.toThrow("managed principal grants");
});

test("createRemoteContainer fetches the parent projection and submits the materialized mutation", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const submittedRequests: ContainerMutationRequest[] = [];
  const result = await createRemoteContainer({
    apiClient: {
      getContainerWriterProjection: async (containerId) =>
        containerId === parent.projection.containerId
          ? parent.projection
          : null,
      createContainer: async (request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    author,
    containerId: "remote-child-container",
    containerKeyEpochId: "remote-child-container-key-epoch-1",
    metadataDocumentId: "remote-child-container-metadata-document",
    parentContainerId: parent.projection.containerId,
    parentSecretKey: parent.secretKey,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
  });

  expect(result?.containerId).toBe("remote-child-container");
  expect(result?.metadataDocumentId).toBe(
    "remote-child-container-metadata-document",
  );
  expect(submittedRequests).toHaveLength(1);
  expect(submittedRequests[0]?.expectedManifestHash).toBe(
    result?.plan.manifestHash,
  );
  expect(isContainerMutationRequest(result?.plan.request)).toBe(true);
});
