import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createContainer as createContainerRequest } from "../../../test/helpers/api/createContainer";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { grantContainerAccess } from "../../access/containerAccess";
import { storeVerifiedPrincipalState } from "../../access/principalStateStore";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import {
  containerMetadataDocuments,
  containers,
  groups,
  users,
} from "../../schema";

const PRINCIPAL_STATE_BASE_TIME_MS = Date.UTC(2000, 0, 1, 0, 0, 0);

async function getRootContainerIdForUser(userId: string): Promise<string> {
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
    })
    .from(containers)
    .where(eq(containers.organizationId, user.defaultOrganizationId))
    .limit(1);

  invariant(rootContainer, "expected root container row");
  return rootContainer.id;
}

async function storeCurrentGroupState(
  groupId: string,
  memberUserIds: string[],
): Promise<void> {
  const principalKem = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: groupId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
        keyFingerprint: await toFingerprint(principalKem.publicKey),
        members: memberUserIds.map((userId) => ({
          principalType: "user",
          principalId: userId,
        })),
        signedAt: new Date(PRINCIPAL_STATE_BASE_TIME_MS).toISOString(),
        signerKeyId: "group-policy-key",
      },
      signingPrivateKey,
    ),
    signingPublicKey,
  );
}

test("GET /containers returns the readable structural forest for the authenticated user", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const otherUser = createTestUser();
  await registerUser(otherUser);
  await authenticate(otherUser);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const childId = crypto.randomUUID();

  const createResponse = await createContainerRequest(
    { id: childId, parentId: ownerRootId },
    owner.token,
  );

  expect(createResponse.status).toBe(200);
  const createdChild = await createResponse.json();

  const listResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });

  expect(listResponse.status).toBe(200);
  const listedContainers = await listResponse.json();
  expect(Array.isArray(listedContainers)).toBe(true);
  expect(listedContainers).toHaveLength(2);

  expect(listedContainers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: ownerRootId,
        parentId: null,
      }),
      expect.objectContaining({
        id: childId,
        metadataDocumentId: createdChild.metadataDocumentId,
        organizationId: createdChild.organizationId,
        parentId: ownerRootId,
      }),
    ]),
  );

  const [binding] = await db
    .select({
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, ownerRootId))
    .limit(1);

  expect(binding?.documentId).toBeDefined();

  const otherListResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${otherUser.token}`,
    },
  });

  expect(otherListResponse.status).toBe(200);
  const otherListedContainers = await otherListResponse.json();
  expect(otherListedContainers).toHaveLength(1);
  expect(otherListedContainers[0]?.id).not.toBe(ownerRootId);
  expect(otherListedContainers[0]?.id).not.toBe(childId);
});

test("GET /containers includes descendants of directly shared containers outside org membership", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();
  const descendantContainerId = crypto.randomUUID();

  const sharedCreateResponse = await createContainerRequest(
    { id: sharedContainerId, parentId: ownerRootId },
    owner.token,
  );

  expect(sharedCreateResponse.status).toBe(200);

  const descendantCreateResponse = await createContainerRequest(
    { id: descendantContainerId, parentId: sharedContainerId },
    owner.token,
  );

  expect(descendantCreateResponse.status).toBe(200);

  await grantContainerAccess({
    accessLevel: "read",
    containerId: sharedContainerId,
    subjectId: recipient.userId,
    subjectType: "user",
  });

  const response = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${recipient.token}`,
    },
  });

  expect(response.status).toBe(200);
  const listedContainers = await response.json();
  expect(listedContainers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: recipient.rootContainerId,
        parentId: null,
      }),
      expect.objectContaining({
        id: sharedContainerId,
        parentId: ownerRootId,
      }),
      expect.objectContaining({
        id: descendantContainerId,
        parentId: sharedContainerId,
      }),
    ]),
  );
});

test("GET /containers includes descendants shared through projection-backed group membership", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();
  const descendantContainerId = crypto.randomUUID();

  const sharedCreateResponse = await createContainerRequest(
    { id: sharedContainerId, parentId: ownerRootId },
    owner.token,
  );

  expect(sharedCreateResponse.status).toBe(200);

  const descendantCreateResponse = await createContainerRequest(
    { id: descendantContainerId, parentId: sharedContainerId },
    owner.token,
  );

  expect(descendantCreateResponse.status).toBe(200);

  const [ownerRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner row");

  const [group] = await db
    .insert(groups)
    .values({
      name: "Readers",
      organizationId: ownerRow.defaultOrganizationId,
    })
    .returning({ id: groups.id });
  invariant(group, "expected group row");

  await storeCurrentGroupState(group.id, [recipient.userId]);

  await grantContainerAccess({
    accessLevel: "read",
    containerId: sharedContainerId,
    subjectId: group.id,
    subjectType: "group",
  });

  const response = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${recipient.token}`,
    },
  });

  expect(response.status).toBe(200);
  const listedContainers = await response.json();
  expect(listedContainers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: recipient.rootContainerId,
        parentId: null,
      }),
      expect.objectContaining({
        id: sharedContainerId,
        parentId: ownerRootId,
      }),
      expect.objectContaining({
        id: descendantContainerId,
        parentId: sharedContainerId,
      }),
    ]),
  );
});
