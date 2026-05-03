import { expect, test } from "bun:test";
import {
  type AccessEvent,
  BLOB_CONTENT_KEY_WRAP_SUITE,
  CONTAINER_KEK_MATERIAL_ID_PREFIX,
  type ContainerAccessEventBody,
  type ContainerAccessLevel,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerDirectGrant,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerRevokeAccessEventBody,
  type ContainerUserRecipientKey,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeBlobAccessManifestHash,
  computeContainerKekMaterialId,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computeWriteHeaderHash,
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
  type WriteHeader,
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
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../blobs";
import { uploadDocumentAttachment } from "../documents/blobRuntime";
import {
  buildMaterializedDocumentCreatePlan,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "../documents/documentRuntime";
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
  body: ContainerAccessEventBody;
  dependencyManifestHashes: readonly string[];
  eventId: string;
  objectId: string;
  organizationId: string;
  previousManifestHash: string | null;
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
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...input.dependencyManifestHashes],
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
  referencedPrincipalHeads: ContainerAccessManifestState["referencedPrincipalHeads"];
}): Promise<VerifiedContainerAccessManifest> {
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: [...input.referencedPrincipalHeads],
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    dependencyManifestHashes: [],
    eventId: input.eventId,
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
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
    referencedPrincipalHeads: [...input.referencedPrincipalHeads],
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

async function createContainerRevokeManifestFixture(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKeyEpochId: string;
  eventId: string;
  organizationId: string;
  previousManifest: VerifiedContainerAccessManifest;
  subjectId: string;
  subjectType: ContainerRevokeAccessEventBody["subjectType"];
}): Promise<VerifiedContainerAccessManifest> {
  const body: ContainerRevokeAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId: input.containerKeyEpochId,
    subjectId: input.subjectId,
    subjectType: input.subjectType,
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    dependencyManifestHashes: [input.previousManifest.manifestHash],
    eventId: input.eventId,
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifest.manifestHash,
    signer: input.author,
  });
  const state: ContainerAccessManifestState = {
    ...input.previousManifest.state,
    epoch: input.previousManifest.state.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: input.previousManifest.state.directGrants.filter(
      (grant) =>
        grant.subjectType !== input.subjectType ||
        grant.subjectId !== input.subjectId,
    ),
    referencedPrincipalHeads:
      input.subjectType === "user"
        ? [...input.previousManifest.state.referencedPrincipalHeads]
        : input.previousManifest.state.referencedPrincipalHeads.filter(
            (head) =>
              head.principalType !== input.subjectType ||
              head.principalId !== input.subjectId,
          ),
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
    previousContainerPath: [input.previousManifest],
    previousManifest: input.previousManifest,
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
  const keyPair = generateKemSeedAndKeyPair();
  const parentContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial: parentContainerKek,
  });
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
    referencedPrincipalHeads: [],
  });
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
    trustedLocalProjection: true,
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

test("buildMaterializedContainerCreatePlan commits generated KEK epoch ids to material", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const containerId = "committed-child-container";
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const materialized = await buildMaterializedContainerCreatePlan({
    author,
    containerId,
    containerKey,
    eventId: "committed-child-container-event",
    parentProjection: parent.projection,
    parentSecretKey: parent.secretKey,
    signedAt: SIGNED_AT,
    trustedLocalProjection: true,
  });

  expect(materialized.plan.containerKeyEpochId).toBe(
    await computeContainerKekMaterialId({
      containerId,
      keyEpoch: 1,
      keyMaterial: containerKey,
    }),
  );
  expect(
    materialized.plan.containerKeyEpochId.startsWith(
      CONTAINER_KEK_MATERIAL_ID_PREFIX,
    ),
  ).toBe(true);
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
      trustedLocalProjection: true,
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
      trustedLocalProjection: true,
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

test("unwrapContainerKekPath rejects substituted material for committed KEK ids", async () => {
  const parent = await createParentProjection();
  const target = parent.parentKekState.recipientTargets.find(
    (candidate) =>
      candidate.recipientKind === "user" &&
      candidate.recipientId === parent.userId,
  );
  if (!target) {
    throw new Error("Expected parent user recipient target");
  }

  const substituteKek = crypto.getRandomValues(new Uint8Array(32));
  const substituteWrap = await createUserContainerWrap({
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    containerKek: substituteKek,
    publicKey: parent.encapsulationPublicKey,
    recipientKeyEpochId: target.recipientKeyEpochId,
    userId: parent.userId,
    wrapManifestHash: parent.parentKekState.accessManifestHash,
  });
  const tamperedProjection = structuredClone(parent.projection);
  const kek = tamperedProjection.containerKeks[0];
  if (!kek) {
    throw new Error("Expected projection KEK");
  }
  kek.wraps = [substituteWrap];

  await expect(
    unwrapContainerKekPath({
      projection: tamperedProjection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      secretKey: parent.secretKey,
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");
});

test("unwrapContainerKekPath rejects revoked users after KEK epoch rotation", async () => {
  const revokedUserId = "user-2";
  const revokedKeyPair = generateKemSeedAndKeyPair();
  const revokedSigning = generateSigningSeedAndKeyPair();
  const revokedRecipientKeyFingerprint = await toFingerprint(
    revokedKeyPair.publicKey,
  );
  const revokedRecipientKeyEpochId = `user:${revokedUserId}:encapsulation:${revokedRecipientKeyFingerprint}`;
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: revokedKeyPair.publicKey,
      recipientKeyEpochId: revokedRecipientKeyEpochId,
      userId: revokedUserId,
    },
  });
  const resolveProjectionUserKey = async (userId: string) => {
    if (userId === parent.userId) {
      return {
        encapsulationPublicKey: parent.encapsulationPublicKey,
        signingPublicKey: parent.signingPublicKey,
        userId,
      };
    }
    if (userId === revokedUserId) {
      return {
        encapsulationPublicKey: revokedKeyPair.publicKey,
        signingPublicKey: revokedSigning.signingPublicKey,
        userId,
      };
    }

    return null;
  };

  const revokedUserPreviousKeks = await unwrapContainerKekPath({
    projection: parent.projection,
    resolveProjectionUserKey,
    secretKey: revokedKeyPair.secretKey,
  });
  const previousContainerKek = revokedUserPreviousKeks.get(
    parent.parentKekState.containerKeyEpochId,
  );
  if (!previousContainerKek) {
    throw new Error("Expected revoked user to unwrap the pre-revocation KEK");
  }

  const previousManifest = parent.projection
    .path[0] as unknown as VerifiedContainerAccessManifest;
  const rotatedContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const rotatedContainerKeyEpochId = await computeContainerKekMaterialId({
    containerId: parent.parentKekState.containerId,
    keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
    keyMaterial: rotatedContainerKek,
  });
  const revokedManifest = await createContainerRevokeManifestFixture({
    author: parent.author,
    containerId: parent.parentKekState.containerId,
    containerKeyEpochId: rotatedContainerKeyEpochId,
    eventId: "parent-container-revoke-event-2",
    organizationId: parent.projection.organizationId,
    previousManifest,
    subjectId: revokedUserId,
    subjectType: "user",
  });
  const ownerRecipientKeyFingerprint = await toFingerprint(
    parent.encapsulationPublicKey,
  );
  const ownerRecipientKeyEpochId = `user:${parent.userId}:encapsulation:${ownerRecipientKeyFingerprint}`;
  const ownerWrap = await createUserContainerWrap({
    containerKeyEpochId: rotatedContainerKeyEpochId,
    containerKek: rotatedContainerKek,
    publicKey: parent.encapsulationPublicKey,
    recipientKeyEpochId: ownerRecipientKeyEpochId,
    userId: parent.userId,
    wrapManifestHash: revokedManifest.manifestHash,
  });
  const rotatedKeyEpoch: ContainerKeyEpoch = {
    id: rotatedContainerKeyEpochId,
    containerId: parent.parentKekState.containerId,
    keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
    accessManifestHash: revokedManifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: revokedManifest.event.eventHash,
    createdByManifestHash: revokedManifest.manifestHash,
  };
  const verifiedRotatedKek = await verifyContainerKekState({
    containerManifest: revokedManifest,
    keyEpoch: rotatedKeyEpoch,
    userRecipientKeys: [
      {
        recipientKeyEpochId: ownerWrap.recipientKeyEpochId,
        recipientKeyFingerprint: ownerWrap.recipientKeyFingerprint,
        userId: parent.userId,
      },
    ],
    wraps: [ownerWrap],
  });
  expect(verifiedRotatedKek.ok).toBe(true);
  if (!verifiedRotatedKek.ok) {
    throw verifiedRotatedKek.error;
  }
  const rotatedKekState = verifiedRotatedKek.value;
  const revokedProjection: ContainerWriterProjectionResponse = {
    containerId: parent.projection.containerId,
    organizationId: parent.projection.organizationId,
    path: [
      revokedManifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
    containerKeks: [
      {
        ...(rotatedKekState as unknown as ContainerWriterProjectionResponse["containerKeks"][number]),
        containerManifestHistory: [
          previousManifest as unknown as ContainerWriterProjectionResponse["path"][number],
        ],
      },
    ],
  };

  expect(revokedManifest.state.directGrants).toEqual([
    {
      subjectType: "user",
      subjectId: parent.userId,
      accessLevel: "admin",
    },
  ]);
  expect(
    rotatedKekState.recipientTargets.map((target) => target.recipientId),
  ).toEqual([parent.userId]);
  const ownerRotatedKeks = await unwrapContainerKekPath({
    projection: revokedProjection,
    resolveProjectionUserKey,
    secretKey: parent.secretKey,
  });
  expect(
    Array.from(ownerRotatedKeks.get(rotatedContainerKeyEpochId) ?? []),
  ).toEqual(Array.from(rotatedContainerKek));

  await expect(
    unwrapContainerKekPath({
      projection: revokedProjection,
      resolveProjectionUserKey,
      secretKey: revokedKeyPair.secretKey,
    }),
  ).rejects.toThrow("could not be unwrapped");

  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const createdDocument = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: revokedProjection,
    contentKey,
    documentId: "550e8400-e29b-41d4-a716-446655440700",
    eventId: "document-after-revoke-event",
    resolveProjectionUserKey,
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });
  const [targetEnvelope] =
    createdDocument.plan.request.contentKeyBundle.targets;
  if (!targetEnvelope) {
    throw new Error("Expected document content-key target");
  }
  expect(createdDocument.plan.targets).toEqual([
    {
      containerId: parent.projection.containerId,
      containerManifestHash: revokedManifest.manifestHash,
      containerKeyEpoch: 2,
      containerKeyEpochId: rotatedContainerKeyEpochId,
    },
  ]);
  const ownerContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: rotatedContainerKek,
    envelope: targetEnvelope,
  });
  expect(Array.from(ownerContentKey)).toEqual(Array.from(contentKey));
  await expect(
    unwrapDocumentContentKeyTarget({
      containerKek: previousContainerKek,
      envelope: targetEnvelope,
    }),
  ).rejects.toThrow();

  const documentWriterProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [revokedProjection],
    contentKeyBundle: {
      documentId: createdDocument.plan.documentId,
      contentKeyEpoch:
        createdDocument.plan.request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash:
        createdDocument.plan.request.contentKeyBundle.linkSetManifestHash,
      targetHash: createdDocument.plan.request.contentKeyBundle.targetHash,
      targets: [...createdDocument.plan.request.contentKeyBundle.targets],
    },
    documentId: createdDocument.plan.documentId,
    documentKekTargets: {
      documentId: createdDocument.plan.documentId,
      linkSetManifestHash: createdDocument.plan.manifestHash,
      linkedContainerManifestHashes: createdDocument.plan.targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: createdDocument.plan.targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets: createdDocument.plan.targets.map((target) => ({ ...target })),
      documentKeyTargetHash: createdDocument.plan.targetHash,
    },
    documentManifest: {
      event: {
        event: createdDocument.plan.event as unknown as Record<string, unknown>,
        body: createdDocument.plan.body as unknown as Record<string, unknown>,
        eventHash: createdDocument.plan.eventHash,
      },
      manifest: createdDocument.plan.manifest as unknown as Record<
        string,
        unknown
      >,
      manifestHash: createdDocument.plan.manifestHash,
      state: createdDocument.plan.state as unknown as Record<string, unknown>,
    },
  };
  const blobId = "550e8400-e29b-41d4-a716-446655440701";
  const bindingId = "550e8400-e29b-41d4-a716-446655440702";
  const slotId = "preview-after-revoke";
  const blobContentKey = crypto.getRandomValues(new Uint8Array(32));
  const uploadedBlob = await uploadDocumentAttachment({
    apiClient: {
      bindBlobAttachment: async (_blobId, request) => {
        const targets = request.contentKeyBundle.targets;
        const linkedContainerManifestHashes = [
          ...new Set(targets.map((target) => target.containerManifestHash)),
        ].sort();
        const linkedContainerKeyEpochIds = [
          ...new Set(targets.map((target) => target.containerKeyEpochId)),
        ].sort();
        if (!request.stagedBlob) {
          throw new Error("Expected staged blob request");
        }
        const blobAccessManifestHash = await computeBlobAccessManifestHash({
          version: 1,
          blobId,
          organizationId: parent.projection.organizationId,
          activeBindingIds: [bindingId],
          documentManifestHashes: [createdDocument.plan.manifestHash],
          linkedContainerManifestHashes,
          linkedContainerKeyEpochIds,
          blobKeyTargetHash: request.contentKeyBundle.targetHash,
        });

        return {
          bindingId,
          blobId,
          documentId: createdDocument.plan.documentId,
          slotId,
          contentKeyBundle: {
            blobId,
            ...request.contentKeyBundle,
          },
          blobKekTargets: {
            blobId,
            organizationId: parent.projection.organizationId,
            activeBindingIds: [bindingId],
            documentManifestHashes: [createdDocument.plan.manifestHash],
            linkedContainerManifestHashes,
            linkedContainerKeyEpochIds,
            targets: targets.map((target) => ({ ...target })),
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
            blobAccessManifestHash,
          },
          writeHeaderHash: await computeWriteHeaderHash(
            request.stagedBlob.writeHeader as unknown as WriteHeader,
          ),
        };
      },
      getDocumentWriterProjection: async (documentId) =>
        documentId === createdDocument.plan.documentId
          ? documentWriterProjection
          : null,
      stageBlob: async () => ({
        stageId: "stage-blob-after-revoke",
        expiresAt: "2026-04-28T13:00:00.000Z",
      }),
    },
    author: parent.author,
    bindingId,
    blobId,
    bytes: new Uint8Array([1, 2, 3, 4]) as BlobBytes,
    contentKey: blobContentKey,
    documentId: createdDocument.plan.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: SIGNED_AT,
    slotId,
    targetSecretKey: parent.secretKey,
  });
  if (!uploadedBlob) {
    throw new Error("Expected blob attachment upload");
  }
  const [blobTargetEnvelope] = uploadedBlob.request.contentKeyBundle.targets;
  if (!blobTargetEnvelope) {
    throw new Error("Expected blob content-key target");
  }
  const blobWrappingMetadata = blobTargetEnvelope.wrappingMetadata;
  if (
    !blobWrappingMetadata ||
    typeof blobWrappingMetadata !== "object" ||
    Array.isArray(blobWrappingMetadata)
  ) {
    throw new Error("Expected blob wrapping metadata");
  }
  const blobWrapSuite = Reflect.get(blobWrappingMetadata, "suite");
  const blobWrapIv = Reflect.get(blobWrappingMetadata, "iv");
  expect(blobWrapSuite).toBe(BLOB_CONTENT_KEY_WRAP_SUITE);
  if (typeof blobWrapIv !== "string" || blobWrapIv.length === 0) {
    throw new Error("Expected blob wrapping IV");
  }
  expect(blobTargetEnvelope).toEqual(
    expect.objectContaining({
      containerManifestHash: revokedManifest.manifestHash,
      containerKeyEpoch: 2,
      containerKeyEpochId: rotatedContainerKeyEpochId,
    }),
  );
  const ownerBlobContentKey = await decryptWithDek(
    {
      iv: base64ToBytes(blobWrapIv),
      ciphertext: base64ToBytes(blobTargetEnvelope.wrappedKey),
    },
    rotatedContainerKek,
  );
  expect(Array.from(ownerBlobContentKey)).toEqual(Array.from(blobContentKey));
  await expect(
    decryptWithDek(
      {
        iv: base64ToBytes(blobWrapIv),
        ciphertext: base64ToBytes(blobTargetEnvelope.wrappedKey),
      },
      previousContainerKek,
    ),
  ).rejects.toThrow();
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
