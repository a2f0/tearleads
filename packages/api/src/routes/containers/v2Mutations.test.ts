import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBodyV2,
  ContainerAccessManifestStateV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  KekRecipientKindV2,
  KeyingV2CanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  signAccessEvent,
  toFingerprint,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  ContainerV2ManifestBundle,
  ContainerV2MutationRequest,
} from "@tearleads/validators/request";
import {
  type ContainerV2MutationResponse,
  isContainerV2MutationResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { storeVerifiedAccessManifest } from "../../access/accessManifestStore";
import { storeVerifiedContainerKekState } from "../../access/containerKekStore";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { containers, objectRecipientEnvelopes, users } from "../../schema";

interface RootContainerFixture {
  readonly id: string;
  readonly organizationId: string;
}

interface StoredV2ContainerFixture {
  readonly bundle: ContainerV2ManifestBundle;
  readonly kekState: VerifiedContainerKekState;
  readonly userKey?: ContainerUserRecipientKeyV2;
}

async function getRootContainerForUser(
  userId: string,
): Promise<RootContainerFixture> {
  const [user] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected user row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);

  invariant(rootContainer, "expected root container row");
  return rootContainer;
}

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

async function userRecipientKey(
  user: TestUser,
): Promise<ContainerUserRecipientKeyV2> {
  return {
    userId: user.userId,
    recipientKeyEpochId: `user:${user.userId}:encapsulation:v1`,
    recipientKeyFingerprint: await toFingerprint(user.kem.publicKey),
  };
}

function asVerifiedContainerManifest(
  bundle: ContainerV2ManifestBundle,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function accessManifestFromResponse(
  response: ContainerV2MutationResponse,
): ContainerV2ManifestBundle {
  return response.accessManifest as unknown as ContainerV2ManifestBundle;
}

function kekStateFromResponse(
  response: ContainerV2MutationResponse,
): VerifiedContainerKekState {
  return response.containerKek as unknown as VerifiedContainerKekState;
}

async function createSignedContainerEvent(input: {
  readonly body: ContainerAccessEventBodyV2;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: TestUser;
}): Promise<VerifiedAccessEvent> {
  const event = await signAccessEvent(
    {
      version: 2,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingV2CanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-04-26T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingV2CanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });

  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function createManifestBundle(
  state: ContainerAccessManifestStateV2,
  event: VerifiedAccessEvent,
): Promise<ContainerV2ManifestBundle> {
  const manifest = await deriveContainerAccessManifest(state);

  return {
    event: event as unknown as Record<string, unknown>,
    manifest: manifest as unknown as Record<string, unknown>,
    manifestHash: await computeAccessManifestHash(manifest),
    state: state as unknown as Record<string, unknown>,
  };
}

function createContainerKeyEpoch(input: {
  readonly containerKeyEpochId: string;
  readonly keyEpoch: number;
  readonly manifest: ContainerV2ManifestBundle;
  readonly parentKekState: VerifiedContainerKekState | null;
}): ContainerKeyEpochV2 {
  const verifiedManifest = asVerifiedContainerManifest(input.manifest);

  return {
    id: input.containerKeyEpochId,
    containerId: verifiedManifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: verifiedManifest.manifestHash,
    parentContainerKeyEpochId:
      input.parentKekState?.containerKeyEpochId ?? null,
    createdByEventHash: verifiedManifest.event.eventHash,
    createdByManifestHash: verifiedManifest.manifestHash,
  };
}

function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
  readonly recipientKeyFingerprint: string;
  readonly recipientKind: KekRecipientKindV2;
  readonly wrapManifestHash: string;
}): ContainerKeyWrapV2 {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: input.recipientKind,
    recipientId: input.recipientId,
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientKeyFingerprint,
    kemCipherText: `kem:${input.containerKeyEpochId}:${input.recipientId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}:${input.recipientId}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

async function verifyKekState(input: {
  readonly bundle: ContainerV2ManifestBundle;
  readonly containerManifestHistory?: readonly ContainerV2ManifestBundle[];
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly parentKekState?: VerifiedContainerKekState | null;
  readonly userRecipientKeys?: readonly ContainerUserRecipientKeyV2[];
  readonly wraps: readonly ContainerKeyWrapV2[];
}): Promise<VerifiedContainerKekState> {
  const containerManifestHistory = input.containerManifestHistory?.map(
    asVerifiedContainerManifest,
  );
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(input.bundle),
    keyEpoch: input.keyEpoch,
    parentKekState: input.parentKekState ?? null,
    userRecipientKeys: input.userRecipientKeys ?? [],
    wraps: input.wraps,
    ...(containerManifestHistory !== undefined
      ? { containerManifestHistory }
      : {}),
  });

  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

async function bootstrapRootV2(
  owner: TestUser,
): Promise<StoredV2ContainerFixture> {
  const rootContainer = await getRootContainerForUser(owner.userId);
  const ownerKey = await userRecipientKey(owner);
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: owner.userId,
        accessLevel: "admin",
      },
    ],
    referencedPrincipalHeads: [],
  };
  const event = await createSignedContainerEvent({
    body,
    objectId: rootContainer.id,
    organizationId: rootContainer.organizationId,
    previousManifestHash: null,
    signer: owner,
  });
  const bundle = await createManifestBundle(
    {
      version: 2,
      containerId: rootContainer.id,
      organizationId: rootContainer.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: null,
      parentManifestHash: null,
      containerKeyEpochId,
      directGrants: body.directGrants,
      referencedPrincipalHeads: [],
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: 1,
    manifest: bundle,
    parentKekState: null,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "user",
      recipientId: owner.userId,
      recipientKeyEpochId: ownerKey.recipientKeyEpochId,
      recipientKeyFingerprint: ownerKey.recipientKeyFingerprint,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];
  const kekState = await verifyKekState({
    bundle,
    keyEpoch,
    userRecipientKeys: [ownerKey],
    wraps,
  });

  await storeVerifiedAccessManifest({
    verifiedManifest: asVerifiedContainerManifest(bundle),
  });
  await storeVerifiedContainerKekState({ verifiedState: kekState });

  return { bundle, kekState, userKey: ownerKey };
}

async function buildCreateRequest(input: {
  readonly containerId: string;
  readonly dependencyManifestHashesOverride?: readonly string[];
  readonly parent: ContainerV2ManifestBundle;
  readonly parentKekState: VerifiedContainerKekState;
  readonly parentManifestHashOverride?: string;
  readonly signer: TestUser;
}): Promise<ContainerV2MutationRequest> {
  const parent = asVerifiedContainerManifest(input.parent);
  const containerKeyEpochId = crypto.randomUUID();
  const parentManifestHash =
    input.parentManifestHashOverride ?? input.parent.manifestHash;
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash,
    containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: input.dependencyManifestHashesOverride ?? [
      input.parent.manifestHash,
    ],
    objectId: input.containerId,
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      version: 2,
      containerId: input.containerId,
      organizationId: parent.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: parent.state.containerId,
      parentManifestHash,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: 1,
    manifest: bundle,
    parentKekState: input.parentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.parentKekState.containerId,
      recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.parentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath: [input.parent],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

async function buildGrantRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: ContainerV2ManifestBundle;
  readonly previousContainerPath: readonly ContainerV2ManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerV2MutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const recipientKey = await userRecipientKey(input.recipient);
  const grant = {
    subjectType: "user" as const,
    subjectId: input.recipient.userId,
    accessLevel: "read" as const,
  };
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: null,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      directGrants: [...previous.state.directGrants, grant],
    },
    event,
  );
  const wraps = [
    ...(input.previousKekState.wraps as readonly ContainerKeyWrapV2[]),
    createContainerKeyWrap({
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientKind: "user",
      recipientId: recipientKey.userId,
      recipientKeyEpochId: recipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: recipientKey.recipientKeyFingerprint,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    containerManifestHistory: [input.previous],
    keyEpoch: input.previousKekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [recipientKey as unknown as Record<string, unknown>],
  };
}

async function buildRevokeRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: ContainerV2ManifestBundle;
  readonly previousContainerPath: readonly ContainerV2ManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly revokedUser: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerV2MutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.revoke",
    containerKeyEpochId,
    subjectType: "user",
    subjectId: input.revokedUser.userId,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      containerKeyEpochId,
      directGrants: previous.state.directGrants.filter(
        (grant) =>
          grant.subjectType !== "user" ||
          grant.subjectId !== input.revokedUser.userId,
      ),
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.parentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.parentKekState.containerId,
      recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.parentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

async function buildMoveRequest(input: {
  readonly destinationParent: ContainerV2ManifestBundle;
  readonly destinationParentKekState: VerifiedContainerKekState;
  readonly destinationParentPath: readonly ContainerV2ManifestBundle[];
  readonly previous: ContainerV2ManifestBundle;
  readonly previousContainerPath: readonly ContainerV2ManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerV2MutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const destinationParent = asVerifiedContainerManifest(
    input.destinationParent,
  );
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.move",
    parentContainerId: destinationParent.state.containerId,
    parentManifestHash: input.destinationParent.manifestHash,
    containerKeyEpochId,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [...input.previousContainerPath, ...input.destinationParentPath].map(
          (manifest) => manifest.manifestHash,
        ),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: destinationParent.state.containerId,
      parentManifestHash: input.destinationParent.manifestHash,
      containerKeyEpochId,
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.destinationParentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.destinationParentKekState.containerId,
      recipientKeyEpochId: input.destinationParentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.destinationParentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    destinationParentContainerPath: [...input.destinationParentPath],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.destinationParentKekState as unknown as Record<
      string,
      unknown
    >,
    userRecipientKeys: [],
  };
}

async function postV2Mutation(input: {
  readonly path: string;
  readonly request: ContainerV2MutationRequest;
  readonly token: string;
}): Promise<Response> {
  return routeApp.request(input.path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify(input.request),
  });
}

async function expectV2MutationSuccess(
  response: Response,
): Promise<ContainerV2MutationResponse> {
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerV2MutationResponse(body)).toBe(true);
  return body as ContainerV2MutationResponse;
}

async function createV2Child(input: {
  readonly containerId?: string;
  readonly parent: ContainerV2ManifestBundle;
  readonly parentKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerV2MutationResponse> {
  const request = await buildCreateRequest({
    containerId: input.containerId ?? crypto.randomUUID(),
    parent: input.parent,
    parentKekState: input.parentKekState,
    signer: input.signer,
  });

  return expectV2MutationSuccess(
    await postV2Mutation({
      path: "/v2/containers",
      request,
      token: input.signer.token,
    }),
  );
}

async function countObjectRecipientEnvelopes(): Promise<number> {
  return (await db.select().from(objectRecipientEnvelopes)).length;
}

test("POST /v2/containers rejects child creates under stale parent manifests", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRootV2(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    parentManifestHashOverride: "0".repeat(64),
    signer: owner,
  });

  const response = await postV2Mutation({
    path: "/v2/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
});

test("POST /v2/containers rejects signed events with missing dependency manifests", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRootV2(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    dependencyManifestHashesOverride: [],
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const response = await postV2Mutation({
    path: "/v2/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Access event dependency hashes do not match supplied manifests",
  });
});

test("POST /v2/containers/:containerId/share rejects grants signed without admin access", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRootV2(owner);
  const created = await createV2Child({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: intruder,
  });

  const response = await postV2Mutation({
    path: `/v2/containers/${created.containerId}/share`,
    request,
    token: intruder.token,
  });

  expect(response.status).toBe(403);
});

test("POST /v2/containers/:containerId/share stores signed grants without descendant envelope fanout", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRootV2(owner);
  const created = await createV2Child({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: owner,
  });
  const beforeEnvelopeCount = await countObjectRecipientEnvelopes();

  const shared = await expectV2MutationSuccess(
    await postV2Mutation({
      path: `/v2/containers/${created.containerId}/share`,
      request,
      token: owner.token,
    }),
  );

  expect(await countObjectRecipientEnvelopes()).toBe(beforeEnvelopeCount);
  expect(shared.manifestHead.epoch).toBe(2);
  expect(shared.containerKek.containerKeyEpochId).toBe(
    created.containerKek.containerKeyEpochId,
  );
  expect(shared.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
    {
      recipientKind: "user",
      recipientId: recipient.userId,
      recipientKeyEpochId: `user:${recipient.userId}:encapsulation:v1`,
      recipientKeyFingerprint: await toFingerprint(recipient.kem.publicKey),
    },
  ]);
});

test("POST /v2/containers/:containerId/revoke advances the KEK epoch", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRootV2(owner);
  const created = await createV2Child({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const shareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(created),
    previousContainerPath: [root.bundle, accessManifestFromResponse(created)],
    previousKekState: kekStateFromResponse(created),
    recipient,
    signer: owner,
  });
  const shared = await expectV2MutationSuccess(
    await postV2Mutation({
      path: `/v2/containers/${created.containerId}/share`,
      request: shareRequest,
      token: owner.token,
    }),
  );
  const sharedBundle = accessManifestFromResponse(shared);
  const revokeRequest = await buildRevokeRequest({
    parentKekState: root.kekState,
    previous: sharedBundle,
    previousContainerPath: [root.bundle, sharedBundle],
    previousKekState: kekStateFromResponse(shared),
    revokedUser: recipient,
    signer: owner,
  });

  const revoked = await expectV2MutationSuccess(
    await postV2Mutation({
      path: `/v2/containers/${created.containerId}/revoke`,
      request: revokeRequest,
      token: owner.token,
    }),
  );

  expect(revoked.manifestHead.epoch).toBe(3);
  expect(revoked.containerKek.containerKeyEpoch).toBe(2);
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    shared.containerKek.containerKeyEpochId,
  );
  expect(revoked.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
  ]);
});

test("POST /v2/containers/:containerId/move validates destination manifest heads", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRootV2(owner);
  const source = await createV2Child({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const destination = await createV2Child({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const destinationShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(destination),
    previousContainerPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previousKekState: kekStateFromResponse(destination),
    recipient,
    signer: owner,
  });
  const updatedDestination = await expectV2MutationSuccess(
    await postV2Mutation({
      path: `/v2/containers/${destination.containerId}/share`,
      request: destinationShareRequest,
      token: owner.token,
    }),
  );

  const staleMoveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(destination),
    destinationParentKekState: kekStateFromResponse(destination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previous: accessManifestFromResponse(source),
    previousContainerPath: [root.bundle, accessManifestFromResponse(source)],
    previousKekState: kekStateFromResponse(source),
    signer: owner,
  });
  const staleResponse = await postV2Mutation({
    path: `/v2/containers/${source.containerId}/move`,
    request: staleMoveRequest,
    token: owner.token,
  });
  expect(staleResponse.status).toBe(409);

  const moveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(updatedDestination),
    destinationParentKekState: kekStateFromResponse(updatedDestination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(updatedDestination),
    ],
    previous: accessManifestFromResponse(source),
    previousContainerPath: [root.bundle, accessManifestFromResponse(source)],
    previousKekState: kekStateFromResponse(source),
    signer: owner,
  });
  const moved = await expectV2MutationSuccess(
    await postV2Mutation({
      path: `/v2/containers/${source.containerId}/move`,
      request: moveRequest,
      token: owner.token,
    }),
  );

  expect(moved.parentId).toBe(destination.containerId);
  expect(moved.containerKek.parentContainerKeyEpochId).toBe(
    updatedDestination.containerKek.containerKeyEpochId,
  );
});
