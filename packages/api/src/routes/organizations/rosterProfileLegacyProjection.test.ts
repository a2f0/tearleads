import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  containers,
  documents,
  organizationRosterEntries,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { isOrganizationReadModelResponse } from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
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

async function postCreateDocument(
  owner: TestUser,
  request: Awaited<ReturnType<typeof createDocumentRequest>>,
): Promise<Response> {
  return routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

test("directory snapshots filter a legacy out-of-roster profile pointer", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const unrelatedDocument = await createCurrentDocumentProjection({
    containerIds: [actor.rootContainerId],
    createdByFingerprint: actor.fingerprint,
    organizationId,
  });
  await db
    .update(organizationRosterEntries)
    .set({ profileDocumentId: unrelatedDocument.id })
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, actor.userId),
      ),
    );

  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  expect(body.lanes.directory.users[0]?.profileDocumentId).toBeNull();
});

test("directory snapshots filter a legacy multiply-linked profile pointer", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const rosterContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: rosterContainerId,
    organizationId,
    parentId: actor.rootContainerId,
    systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId,
    }),
  });
  const multiplyLinkedDocument = await createCurrentDocumentProjection({
    containerIds: [rosterContainerId, actor.rootContainerId],
    createdByFingerprint: actor.fingerprint,
    organizationId,
  });
  await db
    .update(organizationRosterEntries)
    .set({ profileDocumentId: multiplyLinkedDocument.id })
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, actor.userId),
      ),
    );

  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  expect(body.lanes.directory.users[0]?.profileDocumentId).toBeNull();
});

test("a purged document ID with a legacy roster pointer cannot be recreated", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const root = await bootstrapRoot(actor);
  const documentId = crypto.randomUUID();
  const firstCreate = await postCreateDocument(
    actor,
    await createDocumentRequest({ documentId, owner: actor, root }),
  );
  expect(firstCreate.status).toBe(200);
  const purge = await routeApp.request(`/documents/${documentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${actor.token}` },
  });
  expect(purge.status).toBe(200);
  await db
    .update(organizationRosterEntries)
    .set({ profileDocumentId: documentId })
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, actor.userId),
      ),
    );

  const otherOwner = createTestUser();
  await registerAndAuthenticate(otherOwner);
  const otherRoot = await bootstrapRoot(otherOwner);
  const recreate = await postCreateDocument(
    otherOwner,
    await createDocumentRequest({
      documentId,
      owner: otherOwner,
      root: otherRoot,
    }),
  );

  expect(recreate.status).toBe(409);
  expect(await recreate.json()).toEqual({
    error: "Bound roster profile document IDs cannot be recreated",
  });
  const recreatedRows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId));
  expect(recreatedRows).toEqual([]);
});
