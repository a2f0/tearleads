import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { rootAuditEvents, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { PendingBlobDeletionsResponseSchema } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { seedPendingBlobDeletion } from "../../../test/helpers/pendingBlobDeletion";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

const path = "/root/blobs/pending-deletion";

test("root authentication precedes validation; audited reads respect organization filters", async () => {
  const root = createTestUser();
  await registerAndAuthenticateWithOrganization(root);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(owner);
  const pending = await seedPendingBlobDeletion(db, organizationId);
  const rootHeaders = { Authorization: `Bearer ${root.token}` };
  expect((await routeApp.request(`${path}?limit=0`)).status).toBe(401);
  expect(
    (
      await routeApp.request(`${path}?limit=0`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      })
    ).status,
  ).toBe(403);
  expect(
    (await routeApp.request(`${path}?limit=0`, { headers: rootHeaders }))
      .status,
  ).toBe(400);
  expect(
    (
      await routeApp.request(`${path}?organizationId=bad`, {
        headers: rootHeaders,
      })
    ).status,
  ).toBe(400);
  const response = await routeApp.request(
    `${path}?organizationId=${organizationId}`,
    { headers: rootHeaders },
  );
  expect(response.status).toBe(200);
  const body = PendingBlobDeletionsResponseSchema.parse(await response.json());
  expect(body.blobs.map((row) => row.blobId)).toEqual([pending.blobId]);
  expect(body.blobs[0]?.organizationId).toBe(organizationId);
  expect(body.nextAfterId).toBeNull();
  expect(JSON.stringify(body)).not.toContain(pending.storageKey);
  const audit = await db
    .select()
    .from(rootAuditEvents)
    .where(
      and(
        eq(rootAuditEvents.action, "root.blobs.pendingDeletion.list"),
        eq(rootAuditEvents.actorUserId, root.userId),
      ),
    );
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    targetOrganizationId: organizationId,
    filter: `organizationId=${organizationId}`,
  });
  // Operator privilege does not replace organization administrator authority.
  expect(
    (
      await routeApp.request(
        `/organizations/${organizationId}/blobs/pending-deletion`,
        { headers: rootHeaders },
      )
    ).status,
  ).toBe(403);
});

test("failed root audit prevents the queue transaction and leaks no pending metadata", async () => {
  const root = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(root);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
  const pending = await seedPendingBlobDeletion(db, organizationId);
  const runtime = getDefaultApiServiceRuntime();
  let queueTransactions = 0;
  const app = createRouteApp({
    runtime: {
      ...runtime,
      db: {
        delete: runtime.db.delete.bind(runtime.db),
        execute: runtime.db.execute.bind(runtime.db),
        insert: () => {
          throw new Error("audit unavailable");
        },
        select: runtime.db.select.bind(runtime.db),
        transaction: (...args) => {
          queueTransactions += 1;
          return runtime.db.transaction(...args);
        },
        update: runtime.db.update.bind(runtime.db),
      },
    },
  });
  const response = await app.request(
    `${path}?organizationId=${organizationId}`,
    { headers: { Authorization: `Bearer ${root.token}` } },
  );
  expect(response.status).toBe(500);
  expect(queueTransactions).toBe(0);
  expect(await response.text()).not.toContain(pending.blobId);
});
