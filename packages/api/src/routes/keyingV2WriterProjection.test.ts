import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBodyV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  DocumentLinkAccessEventBodyV2,
  DocumentLinkSetManifestStateV2,
  KeyingV2CanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  ContainerV2ManifestBundle,
  DocumentV2CreateRequest,
} from "@tearleads/validators/request";
import {
  isContainerV2WriterProjectionResponse,
  isDocumentV2CreateResponse,
  isDocumentV2WriterProjectionResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import { registerUser } from "../../test/helpers/registerUser";
import { getAccessManifestBundle } from "../access/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../access/containerKekStore";
import { db } from "../adapters/postgres";
import { routeApp } from "../routeApp";
import { accessManifests, containers, users } from "../schema";

interface RootContainerFixture {
  readonly id: string;
  readonly organizationId: string;
}

interface StoredRootV2Fixture {
  readonly bundle: ContainerV2ManifestBundle;
  readonly kekState: VerifiedContainerKekState;
}

async function getRootContainerForUser(
  userId: string,
): Promise<RootContainerFixture> {
  const [user] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected user row");

  const [rootContainer] = await db
    .select({ id: containers.id, organizationId: containers.organizationId })
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

function asVerifiedContainerManifest(
  bundle: ContainerV2ManifestBundle,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

async function createSignedAccessEvent(input: {
  readonly body: ContainerAccessEventBodyV2 | DocumentLinkAccessEventBodyV2;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly objectKind: "container" | "document";
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: TestUser;
}): Promise<VerifiedAccessEvent> {
  const event = await signAccessEvent(
    {
      version: 2,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: input.objectKind,
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
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verified = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingV2CanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });

  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

async function verifyKekState(input: {
  readonly bundle: ContainerV2ManifestBundle;
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly userRecipientKeys: readonly ContainerUserRecipientKeyV2[];
  readonly wraps: readonly ContainerKeyWrapV2[];
}): Promise<VerifiedContainerKekState> {
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(input.bundle),
    keyEpoch: input.keyEpoch,
    userRecipientKeys: input.userRecipientKeys,
    wraps: input.wraps,
  });

  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

function toContainerKeyEpochV2(
  keyEpoch: Awaited<ReturnType<typeof getCurrentContainerKeyEpoch>>,
): ContainerKeyEpochV2 {
  invariant(keyEpoch, "expected container key epoch");

  return {
    id: keyEpoch.id,
    containerId: keyEpoch.containerId,
    keyEpoch: keyEpoch.keyEpoch,
    accessManifestHash: keyEpoch.accessManifestHash,
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    createdByEventHash: keyEpoch.createdByEventHash,
    createdByManifestHash: keyEpoch.createdByManifestHash,
  };
}

function toContainerKeyWrapV2(
  wrap: Awaited<ReturnType<typeof listContainerKeyWraps>>[number],
): ContainerKeyWrapV2 {
  return {
    containerKeyEpochId: wrap.containerKeyEpochId,
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    kemCipherText: wrap.kemCipherText,
    wrappedKey: wrap.wrappedKey,
    wrapManifestHash: wrap.wrapManifestHash,
  };
}

async function bootstrapRootV2(owner: TestUser): Promise<StoredRootV2Fixture> {
  const rootContainer = await getRootContainerForUser(owner.userId);
  const storedKeyEpoch = await getCurrentContainerKeyEpoch(rootContainer.id);
  const keyEpoch = toContainerKeyEpochV2(storedKeyEpoch);
  const bundle = await getAccessManifestBundle(keyEpoch.accessManifestHash);
  invariant(bundle, "expected registered root container V2 manifest");
  const wraps = (await listContainerKeyWraps(keyEpoch.id)).map(
    toContainerKeyWrapV2,
  );
  const ownerWrap = wraps.find(
    (wrap) =>
      wrap.recipientKind === "user" && wrap.recipientId === owner.userId,
  );
  invariant(ownerWrap, "expected registered root user KEK wrap");
  const ownerKey: ContainerUserRecipientKeyV2 = {
    userId: owner.userId,
    recipientKeyEpochId: ownerWrap.recipientKeyEpochId,
    recipientKeyFingerprint: ownerWrap.recipientKeyFingerprint,
  };
  const kekState = await verifyKekState({
    bundle: bundle as unknown as ContainerV2ManifestBundle,
    keyEpoch,
    userRecipientKeys: [ownerKey],
    wraps,
  });

  return { bundle: bundle as unknown as ContainerV2ManifestBundle, kekState };
}

async function createDocumentV2Request(input: {
  readonly owner: TestUser;
  readonly root: StoredRootV2Fixture;
}): Promise<DocumentV2CreateRequest> {
  const documentId = crypto.randomUUID();
  const body: DocumentLinkAccessEventBodyV2 = {
    eventType: "document.link",
    containerId: input.root.kekState.containerId,
    containerManifestHash: input.root.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.root.bundle.manifestHash],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  const state: DocumentLinkSetManifestStateV2 = {
    version: 2,
    documentId,
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    linkedContainerIds: [input.root.kekState.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targets = [
    {
      containerId: input.root.kekState.containerId,
      containerManifestHash: input.root.bundle.manifestHash,
      containerKeyEpochId: input.root.kekState.containerKeyEpochId,
      containerKeyEpoch: input.root.kekState.containerKeyEpoch,
    },
  ];
  const targetHash = await computeDocumentContentKeyTargetHash(targets);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    targetContainerPath: [
      input.root.bundle as unknown as Record<string, unknown>,
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: targets.map((target) => ({
        ...target,
        wrappedKey: `document-key:${documentId}`,
        wrappingMetadata: { alg: "test-wrap" },
      })),
    },
  };
}

test("GET /v2/containers/:containerId/writer-projection returns signed path and KEK projection", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRootV2(owner);

  const response = await routeApp.request(
    `/v2/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerV2WriterProjectionResponse(body)).toBe(true);
  expect(body.containerId).toBe(root.kekState.containerId);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([root.bundle.manifestHash]);
  expect(body.path[0].event.eventHash).toBe(
    asVerifiedContainerManifest(root.bundle).event.eventHash,
  );
  expect(body.path[0].event.body.eventType).toBe("container.create");
  expect(body.containerKeks).toHaveLength(1);
  expect(body.containerKeks[0].containerKeyEpochId).toBe(
    root.kekState.containerKeyEpochId,
  );
});

test("GET /v2/containers/:containerId/writer-projection rejects users without V2 write access", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(outsider);
  await authenticate(outsider);
  const root = await bootstrapRootV2(owner);

  const response = await routeApp.request(
    `/v2/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${outsider.token}`,
      },
    },
  );

  expect(response.status).toBe(403);
});

test("GET /v2/containers/:containerId/writer-projection rejects malformed stored V2 state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRootV2(owner);

  await db
    .update(accessManifests)
    .set({
      state: {
        ...root.bundle.state,
        version: 1,
      } as KeyingV2CanonicalJson,
    })
    .where(eq(accessManifests.manifestHash, root.bundle.manifestHash));

  const response = await routeApp.request(
    `/v2/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(409);
});

test("GET /v2/documents/:documentId/writer-projection returns document targets and authorizing paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRootV2(owner);
  const createRequest = await createDocumentV2Request({ owner, root });
  const createResponse = await routeApp.request("/v2/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createRequest),
  });
  expect(createResponse.status).toBe(200);
  const created = await createResponse.json();
  expect(isDocumentV2CreateResponse(created)).toBe(true);

  const projectionResponse = await routeApp.request(
    `/v2/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentV2WriterProjectionResponse(projection)).toBe(true);
  expect(projection.documentId).toBe(created.id);
  expect(projection.documentManifest.manifestHash).toBe(
    created.accessManifest.manifestHash,
  );
  expect(projection.documentManifest.event.eventHash).toBe(
    created.accessManifest.event.eventHash,
  );
  expect(projection.documentManifest.event.body.eventType).toBe(
    "document.link",
  );
  expect(projection.documentKekTargets.documentKeyTargetHash).toBe(
    created.documentKekTargets.documentKeyTargetHash,
  );
  expect(projection.contentKeyBundle.targetHash).toBe(
    created.contentKeyBundle.targetHash,
  );
  expect(projection.authorizingContainerPaths).toHaveLength(1);
});
