import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  containers,
  documentContainerLinks,
  organizationRosterEntries,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

test("self bindings reject an owned document outside the roster container", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });
  const nonRosterProfile = await createCurrentDocumentProjection({
    containerIds: [actor.rootContainerId],
    createdByFingerprint: member.fingerprint,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/roster/${member.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({
        profileDocumentId: nonRosterProfile.id,
      }),
    },
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error:
      "Profile document is not in this organization's roster profile container",
  });
  const [memberRosterEntry] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(memberRosterEntry?.profileDocumentId).toBeNull();
});

test("members can bind their own roster profile document", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });
  const rosterProfileContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: rosterProfileContainerId,
    organizationId,
    parentId: actor.rootContainerId,
    systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId,
    }),
  });
  const profile = await createCurrentDocumentProjection({
    containerIds: [rosterProfileContainerId],
    createdByFingerprint: member.fingerprint,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/roster/${member.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: profile.id }),
    },
  );

  expect(response.status).toBe(200);
  const [rosterEntry] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(rosterEntry?.profileDocumentId).toBe(profile.id);
});

test("a bound roster profile document cannot be purged", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const root = await bootstrapRoot(actor);
  await db
    .update(containers)
    .set({
      systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
        organizationId,
      }),
    })
    .where(eq(containers.id, root.kekState.containerId));
  const profile = await createDocument({ owner: actor, root });
  const bindResponse = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: profile.id }),
    },
  );
  expect(bindResponse.status).toBe(200);

  const purgeResponse = await routeApp.request(`/documents/${profile.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${actor.token}` },
  });

  expect(purgeResponse.status).toBe(409);
  expect(await purgeResponse.json()).toEqual({
    error: "Bound roster profile documents cannot be purged",
  });
  const [binding] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, actor.userId),
      ),
    );
  expect(binding?.profileDocumentId).toBe(profile.id);
});

test("a multiply linked document cannot become a roster profile", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const root = await bootstrapRoot(actor);
  const rosterContainer = await createChildContainer({
    parent: root,
    signer: actor,
  });
  await db
    .update(containers)
    .set({
      systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
        organizationId,
      }),
    })
    .where(eq(containers.id, rosterContainer.containerId));
  const createdDocument = await createDocument({ owner: actor, root });
  const linkRequest = await buildDocumentLinkRequest({
    child: rosterContainer,
    createdDocument,
    owner: actor,
    root,
  });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(linkRequest),
    },
  );
  expect(linkResponse.status).toBe(200);

  const bindResponse = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: createdDocument.id }),
    },
  );
  expect(bindResponse.status).toBe(400);
  const [binding] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, actor.userId),
      ),
    );
  expect(binding?.profileDocumentId).toBeNull();
});

test("a bound roster profile cannot gain another container link", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const root = await bootstrapRoot(actor);
  await db
    .update(containers)
    .set({
      systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
        organizationId,
      }),
    })
    .where(eq(containers.id, root.kekState.containerId));
  const createdDocument = await createDocument({ owner: actor, root });
  const bindResponse = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: createdDocument.id }),
    },
  );
  expect(bindResponse.status).toBe(200);

  const secondContainer = await createChildContainer({
    parent: root,
    signer: actor,
  });
  const linkRequest = await buildDocumentLinkRequest({
    child: secondContainer,
    createdDocument,
    owner: actor,
    root,
  });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(linkRequest),
    },
  );

  expect(linkResponse.status).toBe(409);
  expect(await linkResponse.json()).toEqual({
    error:
      "Bound roster profile documents must remain exclusively in the roster profile container",
  });
  const links = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, createdDocument.id));
  expect(links.map((link) => link.containerId)).toEqual([
    root.kekState.containerId,
  ]);
});

test("admin bindings reject a document outside the roster container", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });
  const nonRosterProfile = await createCurrentDocumentProjection({
    containerIds: [actor.rootContainerId],
    createdByFingerprint: actor.fingerprint,
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
      body: JSON.stringify({
        profileDocumentId: nonRosterProfile.id,
      }),
    },
  );

  expect(response.status).toBe(400);
  const [memberRosterEntry] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(memberRosterEntry?.profileDocumentId).toBeNull();
});

test("admins can bind their roster document to another member", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });
  const rosterProfileContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: rosterProfileContainerId,
    organizationId,
    parentId: actor.rootContainerId,
    systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId,
    }),
  });
  const profile = await createCurrentDocumentProjection({
    containerIds: [rosterProfileContainerId],
    createdByFingerprint: actor.fingerprint,
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
      body: JSON.stringify({ profileDocumentId: profile.id }),
    },
  );

  expect(response.status).toBe(200);
  const [rosterEntry] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(rosterEntry?.profileDocumentId).toBe(profile.id);
});

test("members cannot bind another user's roster profile document", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });
  const rosterProfileContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: rosterProfileContainerId,
    organizationId,
    parentId: actor.rootContainerId,
    systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId,
    }),
  });
  const actorProfile = await createCurrentDocumentProjection({
    containerIds: [rosterProfileContainerId],
    createdByFingerprint: actor.fingerprint,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/roster/${member.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: actorProfile.id }),
    },
  );

  expect(response.status).toBe(400);
  const [memberRosterEntry] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(memberRosterEntry?.profileDocumentId).toBeNull();
});
