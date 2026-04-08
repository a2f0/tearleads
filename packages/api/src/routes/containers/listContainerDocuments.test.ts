import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { createTestUser } from "../../../test/helpers/createTestUser";
import { registerUser } from "../../../test/helpers/registerUser";
import { grantContainerAccess } from "../../access/containerAccess";
import { storeVerifiedPrincipalState } from "../../access/principalStateStore";
import { db } from "../../adapters/postgres";
import { app } from "../../index";
import { containers, groupMembers, groups, users } from "../../schema";

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
        signedAt: new Date("2026-04-08T12:20:00.000Z").toISOString(),
        signerKeyId: "group-policy-key",
      },
      signingPrivateKey,
    ),
    signingPublicKey,
  );
}

test("GET /containers/:containerId/documents lists readable non-metadata documents for the container", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const createResponse = await createDocument(owner.token, [rootContainerId]);
  expect(createResponse.status).toBe(200);
  const createdDocument = await createResponse.json();

  const response = await app.request(
    `/containers/${rootContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const listedDocuments = await response.json();
  expect(listedDocuments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: createdDocument.id,
        linkedContainerIds: [rootContainerId],
      }),
    ]),
  );
  expect(listedDocuments).toHaveLength(1);
});

test("GET /containers/:containerId/documents returns documents for directly shared containers", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();

  const sharedContainerResponse = await app.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: ownerRootId,
    }),
  });

  expect(sharedContainerResponse.status).toBe(200);

  const createDocumentResponse = await createDocument(owner.token, [
    sharedContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();

  await grantContainerAccess({
    accessLevel: "read",
    containerId: sharedContainerId,
    subjectId: recipient.userId,
    subjectType: "user",
  });

  const response = await app.request(
    `/containers/${sharedContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const listedDocuments = await response.json();
  expect(listedDocuments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: createdDocument.id,
        linkedContainerIds: [sharedContainerId],
      }),
    ]),
  );
});

test("GET /containers/:containerId/documents includes referenced principal policies when access comes from a group grant", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();

  await registerUser(owner);
  await registerUser(recipient);
  await authenticate(owner);
  await authenticate(recipient);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();

  const sharedContainerResponse = await app.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: ownerRootId,
    }),
  });

  expect(sharedContainerResponse.status).toBe(200);

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
      organizationId: ownerRow.defaultOrganizationId,
      name: "Reviewers",
    })
    .returning({ id: groups.id });
  invariant(group, "expected group");

  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: recipient.userId,
  });
  await storeCurrentGroupState(group.id, [recipient.userId]);

  const createDocumentResponse = await createDocument(owner.token, [
    sharedContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();

  await grantContainerAccess({
    accessLevel: "read",
    containerId: sharedContainerId,
    subjectId: group.id,
    subjectType: "group",
  });

  const response = await app.request(
    `/containers/${sharedContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const listedDocuments = await response.json();
  expect(listedDocuments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: createdDocument.id,
        linkedContainerIds: [sharedContainerId],
        referencedPrincipals: [
          expect.objectContaining({
            principalType: "group",
            principalId: group.id,
            version: 1,
            keyEpoch: 1,
          }),
        ],
      }),
    ]),
  );
});
