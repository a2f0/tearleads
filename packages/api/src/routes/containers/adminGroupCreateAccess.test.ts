import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizations, users } from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  signAccessEvent,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@symcrypt/validators/request";
import {
  isContainerMutationResponse,
  isPrincipalPolicyStaleErrorResponse,
} from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createTestContainerKekId } from "../../../test/helpers/containerKekMaterial";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../access/read/containerKekStore";
import { routeApp } from "../../routeApp";

interface RootFixture {
  readonly adminPolicy: VerifiedPrincipalPolicy;
  readonly bundle: AccessManifestBundleWire;
  readonly kekState: VerifiedContainerKekState;
}

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

function asVerifiedContainerManifest(
  bundle: AccessManifestBundleWire,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function toContainerKeyEpoch(
  keyEpoch: Awaited<ReturnType<typeof getCurrentContainerKeyEpoch>>,
): ContainerKeyEpoch {
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

function toContainerKeyWrap(
  wrap: Awaited<ReturnType<typeof listContainerKeyWraps>>[number],
): ContainerKeyWrap {
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

async function getOwnerAdminGroupId(owner: TestUser): Promise<string> {
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(user, "expected owner user row");

  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, user.organizationId))
    .limit(1);
  invariant(organization, "expected owner organization row");

  return organization.adminGroupId;
}

async function bootstrapRoot(owner: TestUser): Promise<RootFixture> {
  const keyEpoch = toContainerKeyEpoch(
    await getCurrentContainerKeyEpoch(owner.rootContainerId, db),
  );
  const bundle = await getAccessManifestBundle(keyEpoch.accessManifestHash, db);
  invariant(bundle, "expected owner root manifest");
  const adminPolicy = await loadVerifiedPrincipalPolicy(
    db,
    "group",
    await getOwnerAdminGroupId(owner),
  );
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(
      bundle as unknown as AccessManifestBundleWire,
    ),
    keyEpoch,
    parentKekState: null,
    principalPolicies: [adminPolicy],
    wraps: (await listContainerKeyWraps(keyEpoch.id, db)).map(
      toContainerKeyWrap,
    ),
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return {
    adminPolicy,
    bundle: bundle as unknown as AccessManifestBundleWire,
    kekState: verified.value,
  };
}

async function advanceAdminPolicy(input: {
  readonly owner: TestUser;
  readonly peer: TestUser;
}): Promise<void> {
  await addUserToAdminGroup({
    actor: input.owner,
    member: input.peer,
    organizationId: await getDefaultOrganizationId(input.owner.userId),
  });
}

async function createSignedContainerEvent(input: {
  readonly body: ContainerAccessEventBody;
  readonly objectId: string;
  readonly organizationId: string;
  readonly parentPath: readonly AccessManifestBundleWire[];
  readonly signer: TestUser;
}): Promise<VerifiedAccessEvent> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: input.parentPath.map(
        (manifest) => manifest.manifestHash,
      ),
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-06-21T12:05:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verified = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

async function createManifestBundle(
  state: ContainerAccessManifestState,
  event: VerifiedAccessEvent,
): Promise<AccessManifestBundleWire> {
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
  readonly manifest: AccessManifestBundleWire;
  readonly parentKekState: VerifiedContainerKekState;
}): ContainerKeyEpoch {
  const manifest = asVerifiedContainerManifest(input.manifest);

  return {
    id: input.containerKeyEpochId,
    containerId: manifest.state.containerId,
    keyEpoch: 1,
    accessManifestHash: manifest.manifestHash,
    parentContainerKeyEpochId: input.parentKekState.containerKeyEpochId,
    createdByEventHash: manifest.event.eventHash,
    createdByManifestHash: manifest.manifestHash,
  };
}

function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly parentKekState: VerifiedContainerKekState;
  readonly wrapManifestHash: string;
}): ContainerKeyWrap {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "container",
    recipientId: input.parentKekState.containerId,
    recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
    recipientKeyFingerprint: input.parentKekState.keyEpochHash,
    kemCipherText: `kem:${input.containerKeyEpochId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

async function loadCurrentPrincipalPolicies(
  path: readonly AccessManifestBundleWire[],
): Promise<VerifiedPrincipalPolicy[]> {
  const references = path.flatMap(
    (bundle) =>
      asVerifiedContainerManifest(bundle).state.referencedPrincipalHeads,
  );

  return Promise.all(
    references.map((reference) =>
      loadVerifiedPrincipalPolicy(
        db,
        reference.principalType,
        reference.principalId,
      ),
    ),
  );
}

async function buildChildCreateRequest(input: {
  readonly containerId: string;
  readonly parent: AccessManifestBundleWire;
  readonly parentKekState: VerifiedContainerKekState;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const parent = asVerifiedContainerManifest(input.parent);
  const containerKeyEpochId = await createTestContainerKekId(
    input.containerId,
    1,
  );
  const body: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash: input.parent.manifestHash,
    metadataDocumentId: crypto.randomUUID(),
    containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createSignedContainerEvent({
    body,
    objectId: input.containerId,
    organizationId: parent.state.organizationId,
    parentPath: [input.parent],
    signer: input.signer,
  });
  const childBundle = await createManifestBundle(
    {
      version: 1,
      containerId: input.containerId,
      organizationId: parent.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: parent.state.containerId,
      parentManifestHash: input.parent.manifestHash,
      metadataDocumentId: body.metadataDocumentId,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    manifest: childBundle,
    parentKekState: input.parentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      parentKekState: input.parentKekState,
      wrapManifestHash: childBundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: childBundle.manifestHash,
    manifest: childBundle.manifest,
    parentContainerPath: [input.parent],
    principalPolicies: (input.principalPolicies ??
      (await loadCurrentPrincipalPolicies([
        input.parent,
      ]))) as unknown as Record<string, unknown>[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: null,
    predecessorBridge: null,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

test("POST /containers accepts owner create after Admins policy advances", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(peer);

  await advanceAdminPolicy({ owner, peer });
  const root = await bootstrapRoot(owner);

  const containerId = crypto.randomUUID();
  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify(
      await buildChildCreateRequest({
        containerId,
        parent: root.bundle,
        parentKekState: root.kekState,
        signer: owner,
      }),
    ),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(isContainerMutationResponse(body), "expected container response");
  expect(body.containerId).toBe(containerId);
}, 10_000);

test("POST /containers returns current Admins policy when submitted policy is stale", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(peer);
  const staleRoot = await bootstrapRoot(owner);

  await advanceAdminPolicy({ owner, peer });
  const currentRoot = await bootstrapRoot(owner);

  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify(
      await buildChildCreateRequest({
        containerId: crypto.randomUUID(),
        parent: currentRoot.bundle,
        parentKekState: currentRoot.kekState,
        principalPolicies: [staleRoot.adminPolicy],
        signer: owner,
      }),
    ),
  });

  expect(response.status).toBe(409);
  const body = await response.json();
  invariant(
    isPrincipalPolicyStaleErrorResponse(body),
    "expected stale principal policy response",
  );
  expect(body.error).toBe("Principal policy is stale");
  expect(body.principalPolicies).toHaveLength(1);
  expect(body.principalPolicies[0]?.currentState.principalId).toBe(
    staleRoot.adminPolicy.principalId,
  );
  expect(body.principalPolicies[0]?.currentState.version).toBe(
    currentRoot.adminPolicy.version,
  );
}, 10_000);
