import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  containers,
  organizationBilling,
  organizations,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import {
  type AccessEvent,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerGrantPrincipalHead,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  generateKemSeedAndKeyPair,
  type KeyingCanonicalJson,
  signAccessEvent,
  toFingerprint,
  type UnsignedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
  storePrincipalState,
} from "../../../test/helpers/principalState";
import { replacePrincipalMemberEnvelopesInTestTransaction } from "../../../test/helpers/principalStateTransactions";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { storeVerifiedAccessManifest } from "../../access/write/accessManifestStore";
import { listContainers } from "./listContainers";

const SIGNED_AT = "2026-04-30T00:00:00.000Z";

function principalReference(
  state: StoredPrincipalState,
): ContainerGrantPrincipalHead {
  if (state.principalType !== "group") {
    throw new Error("Container grants cannot target organizations");
  }
  return {
    principalType: "group",
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}

async function signContainerEvent(input: {
  body: ContainerCreateAccessEventBody;
  containerId: string;
  organizationId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}): Promise<{ event: AccessEvent; eventHash: string }> {
  const unsigned: UnsignedAccessEvent = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: "container.create",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: [input.body.parentManifestHash].filter(
      (hash): hash is string => hash !== null,
    ),
    bodyHash: await computeAccessEventBodyHash(
      input.body as unknown as KeyingCanonicalJson,
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: `signing-key:${input.signerKeyFingerprint}`,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: SIGNED_AT,
  };
  const event = await signAccessEvent(unsigned, input.signerPrivateKey);

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function storeGroupPolicy(input: {
  groupId: string;
  keyEpoch: number;
  members: readonly { userId: string }[];
  previousStateHash: string | null;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
  version: number;
}): Promise<StoredPrincipalState> {
  const groupKem = generateKemSeedAndKeyPair();
  const projection = createProjectionWithAdminSigner(
    input.signerUserId,
    input.members,
  );
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: groupKem.secretKey,
      projection,
    });
  const payloadCiphertext = JSON.stringify({ members: projection });
  const bundle = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.groupId,
    version: input.version,
    prevStateHash: input.previousStateHash,
    keyEpoch: input.keyEpoch,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    // The signer may also appear in input.members; members must be unique.
    members: stateMembers,
    projection,
    memberEnvelopes,
    payloadCiphertext,
    signedAt: SIGNED_AT,
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: input.signerKeyFingerprint,
    signingPrivateKey: input.signerPrivateKey,
  });

  const storedState = await storePrincipalState(bundle, db);
  await replacePrincipalMemberEnvelopesInTestTransaction(
    {
      principalType: "group",
      principalId: input.groupId,
      stateHash: storedState.stateHash,
      envelopes: memberEnvelopes,
    },
    db,
  );
  return storedState;
}

async function storeTestUser(input: {
  readonly organizationId: string;
  readonly user: ReturnType<typeof createTestUser>;
}): Promise<void> {
  input.user.fingerprint = await toFingerprint(
    input.user.signing.signingPublicKey,
  );
  await db.insert(users).values({
    id: input.user.userId,
    fingerprint: input.user.fingerprint,
    signingPublicKey: bytesToBase64(input.user.signing.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(input.user.kem.publicKey),
    encapsulationKeyFingerprint: await toFingerprint(input.user.kem.publicKey),
    defaultOrganizationId: input.organizationId,
  });
}

async function storeContainerManifest(input: {
  containerId: string;
  directGrants: ContainerCreateAccessEventBody["directGrants"];
  metadataDocumentId: string;
  organizationId: string;
  parentContainerId?: string | null;
  parentManifestHash?: string | null;
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}) {
  const containerKeyEpochId = crypto.randomUUID();
  const directGrants =
    input.parentContainerId === undefined || input.parentContainerId === null
      ? [
          ...input.directGrants,
          {
            accessLevel: "admin" as const,
            subjectType: "user" as const,
            subjectId: input.signerUserId,
          },
        ]
      : input.directGrants;
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash: input.parentManifestHash ?? null,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants,
    referencedPrincipalHeads: input.referencedPrincipalHeads,
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    containerId: input.containerId,
    organizationId: input.organizationId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signerPrivateKey,
    signerUserId: input.signerUserId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.containerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash: input.parentManifestHash ?? null,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const verifiedManifest: VerifiedContainerAccessManifest = {
    event: {
      event,
      body: body as unknown as KeyingCanonicalJson,
      eventHash,
    },
    manifest,
    manifestHash,
    state,
  } as VerifiedContainerAccessManifest;

  await storeVerifiedAccessManifest({ verifiedManifest }, db);
  return manifestHash;
}

function storeContainerWithReferencedGroup(input: {
  containerId: string;
  groupReference: ContainerGrantPrincipalHead;
  metadataDocumentId: string;
  organizationId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}) {
  return storeContainerManifest({
    ...input,
    directGrants: [
      {
        accessLevel: "read",
        subjectType: "group",
        subjectId: input.groupReference.principalId,
      },
    ],
    referencedPrincipalHeads: [input.groupReference],
  });
}

async function storeContainerWithDirectUserGrant(input: {
  containerId: string;
  grantedUserId: string;
  metadataDocumentId: string;
  organizationId: string;
  parentContainerId?: string | null;
  parentManifestHash?: string | null;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}) {
  await storeContainerManifest({
    ...input,
    directGrants: [
      {
        accessLevel: "read",
        subjectType: "user",
        subjectId: input.grantedUserId,
      },
    ],
    referencedPrincipalHeads: [],
  });
}

test("listContainers admits users added by current managed grants when they extend the referenced policy head", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  owner.userId = crypto.randomUUID();
  member.userId = crypto.randomUUID();

  const organizationId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const metadataDocumentId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();

  await db.insert(organizations).values({
    adminGroupId: groupId,
    id: organizationId,
    memberGroupId,
    name: "Manifest Reference Test",
  });
  await db
    .insert(organizationBilling)
    .values({ organizationId, status: "active" });
  await storeTestUser({ organizationId, user: owner });
  await storeTestUser({ organizationId, user: member });
  await db.insert(containers).values({
    id: containerId,
    organizationId,
    parentId: null,
  });

  const originalGroupPolicy = await storeGroupPolicy({
    groupId,
    keyEpoch: 1,
    members: [],
    previousStateHash: null,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
    version: 1,
  });
  const currentGroupPolicy = await storeGroupPolicy({
    groupId,
    keyEpoch: 2,
    members: [{ userId: member.userId }],
    previousStateHash: originalGroupPolicy.stateHash,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
    version: 2,
  });
  await storeContainerWithReferencedGroup({
    containerId,
    groupReference: principalReference(originalGroupPolicy),
    metadataDocumentId,
    organizationId,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
  });

  const listed = await listContainers(
    createServiceTestRuntime(),
    member.userId,
  );

  expect(listed.items.map((container) => container.id)).toContain(containerId);
  expect(
    listed.items.find((container) => container.id === containerId)
      ?.metadataReferencedPrincipals,
  ).toEqual([principalReference(currentGroupPolicy)]);
});

test("listContainers keeps valid containers when a sibling candidate uses a historical managed grant", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  owner.userId = crypto.randomUUID();
  member.userId = crypto.randomUUID();

  const organizationId = crypto.randomUUID();
  const staleContainerId = crypto.randomUUID();
  const readableContainerId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();

  await db.insert(organizations).values({
    adminGroupId: groupId,
    id: organizationId,
    memberGroupId,
    name: "Mixed Batch Manifest Reference Test",
  });
  await db
    .insert(organizationBilling)
    .values({ organizationId, status: "active" });
  await storeTestUser({ organizationId, user: owner });
  await storeTestUser({ organizationId, user: member });
  await db.insert(containers).values([
    {
      id: staleContainerId,
      organizationId,
      parentId: null,
    },
    {
      id: readableContainerId,
      organizationId,
      parentId: staleContainerId,
      depth: 1,
    },
  ]);

  const originalGroupPolicy = await storeGroupPolicy({
    groupId,
    keyEpoch: 1,
    members: [],
    previousStateHash: null,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
    version: 1,
  });
  await storeGroupPolicy({
    groupId,
    keyEpoch: 2,
    members: [{ userId: member.userId }],
    previousStateHash: originalGroupPolicy.stateHash,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
    version: 2,
  });
  const staleManifestHash = await storeContainerWithReferencedGroup({
    containerId: staleContainerId,
    groupReference: principalReference(originalGroupPolicy),
    metadataDocumentId: crypto.randomUUID(),
    organizationId,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
  });
  await storeContainerWithDirectUserGrant({
    containerId: readableContainerId,
    grantedUserId: member.userId,
    metadataDocumentId: crypto.randomUUID(),
    organizationId,
    parentContainerId: staleContainerId,
    parentManifestHash: staleManifestHash,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
  });

  const listed = await listContainers(
    createServiceTestRuntime(),
    member.userId,
  );
  const listedContainerIds = listed.items.map((container) => container.id);

  expect(listedContainerIds).toContain(readableContainerId);
  expect(listedContainerIds).toContain(staleContainerId);
});
