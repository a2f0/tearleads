import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  containers,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { and, eq } from "drizzle-orm";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function createRosterContainerMetadataDocument(input: {
  readonly actor: TestUser;
  readonly organizationId: string;
}): Promise<string> {
  const containerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: containerId,
    organizationId: input.organizationId,
    parentId: input.actor.rootContainerId,
    systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: input.organizationId,
    }),
  });
  const metadataDocument = await createCurrentDocumentProjection({
    containerIds: [containerId],
    createdByFingerprint: input.actor.fingerprint,
    organizationId: input.organizationId,
  });
  await db.insert(containerMetadataDocuments).values({
    containerId,
    documentId: metadataDocument.id,
  });
  return metadataDocument.id;
}

async function expectProfileUnbound(input: {
  readonly organizationId: string;
  readonly userId: string;
}): Promise<void> {
  const [entry] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, input.organizationId),
        eq(organizationRosterEntries.userId, input.userId),
      ),
    );
  expect(entry?.profileDocumentId).toBeNull();
}

test("members cannot bind roster container metadata as their profile", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const metadataDocumentId = await createRosterContainerMetadataDocument({
    actor,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: metadataDocumentId }),
    },
  );

  expect(response.status).toBe(400);
  await expectProfileUnbound({ organizationId, userId: actor.userId });
});

test("admins cannot bind roster container metadata to a member", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const member = createTestUser();
  await registerAndAuthenticateWithOrganization(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });
  const metadataDocumentId = await createRosterContainerMetadataDocument({
    actor,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/roster/${member.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: metadataDocumentId }),
    },
  );

  expect(response.status).toBe(400);
  await expectProfileUnbound({ organizationId, userId: member.userId });
});
