import { afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  type RootAuditAction,
  revenuecatWebhookEvents,
  rootAuditEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import {
  RootOrganizationRevenuecatEventsResponseSchema,
  RootRevenuecatEventsReportResponseSchema,
} from "@tearleads/validators/response";
import { and, desc, eq, inArray } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

const root = createTestUser();
const member = createTestUser();
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const ORGANIZATION_PATH = `/root/organizations/${organizationId}/revenuecat-events`;
const REPORT_PATH = "/root/reports/revenuecat-events";

const inserted: string[] = [];
afterEach(async () => {
  const ids = inserted.splice(0);
  if (ids.length === 0) return;
  await db
    .delete(revenuecatWebhookEvents)
    .where(inArray(revenuecatWebhookEvents.id, ids));
});

async function deliver(
  fields: Partial<typeof revenuecatWebhookEvents.$inferInsert>,
): Promise<string> {
  const id = randomUUID();
  inserted.push(id);
  await db.insert(revenuecatWebhookEvents).values({
    appUserId: randomUUID(),
    eventId: `evt_${id}`,
    eventTimestamp: new Date("2991-01-01T00:00:00.000Z"),
    eventType: "INITIAL_PURCHASE",
    outcome: "applied",
    ...fields,
    id,
  });
  return id;
}

function request(path: string, token: string | null, app = routeApp) {
  return Promise.resolve(
    app.request(path, {
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    }),
  );
}

async function latestAudit(action: RootAuditAction, actorUserId = root.userId) {
  const [row] = await db
    .select()
    .from(rootAuditEvents)
    .where(
      and(
        eq(rootAuditEvents.action, action),
        eq(rootAuditEvents.actorUserId, actorUserId),
      ),
    )
    .orderBy(desc(rootAuditEvents.occurredAt), desc(rootAuditEvents.id))
    .limit(1);
  return row;
}

beforeAll(async () => {
  await registerUser(root);
  await registerUser(member);
  await authenticate(root);
  await authenticate(member);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
});

test("both listings need a root session and record nothing without one", async () => {
  for (const path of [ORGANIZATION_PATH, REPORT_PATH]) {
    expect((await request(path, null)).status).toBe(401);
    expect((await request(path, member.token)).status).toBe(403);
  }
  expect(
    await latestAudit(
      "root.organizations.revenuecatEvents.list",
      member.userId,
    ),
  ).toBeUndefined();
  expect(
    await latestAudit("root.reports.revenuecatEvents.list", member.userId),
  ).toBeUndefined();
});

test("an organization's deliveries are served and audited against it", async () => {
  const applied = await deliver({ organizationId });
  await deliver({ organizationId: otherOrganizationId });

  const response = await request(ORGANIZATION_PATH, root.token);
  expect(response.status).toBe(200);
  const body = RootOrganizationRevenuecatEventsResponseSchema.parse(
    await response.json(),
  );
  expect(body.events.map(({ id, role }) => [id, role])).toEqual([
    [applied, "target"],
  ]);
  expect(
    await latestAudit("root.organizations.revenuecatEvents.list"),
  ).toMatchObject({ filter: null, targetOrganizationId: organizationId });
});

test("the report records its disposition filter", async () => {
  const unmatched = await deliver({ organizationId: null });

  const response = await request(
    `${REPORT_PATH}?disposition=unmatched&limit=1`,
    root.token,
  );
  expect(response.status).toBe(200);
  const body = RootRevenuecatEventsReportResponseSchema.parse(
    await response.json(),
  );
  expect(body.events.map((event) => event.id)).toEqual([unmatched]);
  expect(await latestAudit("root.reports.revenuecatEvents.list")).toMatchObject(
    { filter: "disposition=unmatched", targetOrganizationId: null },
  );
});

test("a cursor serves only the listing that issued it", async () => {
  await deliver({ organizationId });
  await deliver({ organizationId });
  const first = RootOrganizationRevenuecatEventsResponseSchema.parse(
    await (await request(`${ORGANIZATION_PATH}?limit=1`, root.token)).json(),
  );
  expect(first.nextCursor).not.toBeNull();
  const cursor = encodeURIComponent(first.nextCursor ?? "");

  const next = await request(
    `${ORGANIZATION_PATH}?limit=1&cursor=${cursor}`,
    root.token,
  );
  expect(next.status).toBe(200);
  for (const elsewhere of [
    `/root/organizations/${otherOrganizationId}/revenuecat-events?cursor=${cursor}`,
    `${REPORT_PATH}?cursor=${cursor}`,
  ]) {
    expect((await request(elsewhere, root.token)).status).toBe(400);
  }
});

test("an unknown disposition is refused", async () => {
  expect(
    (await request(`${REPORT_PATH}?disposition=paid`, root.token)).status,
  ).toBe(400);
});

test("deliveries are not served when the audit event cannot be written", async () => {
  const eventId = `evt_${await deliver({ organizationId })}`;
  const runtime = getDefaultApiServiceRuntime();
  const app = createRouteApp({
    runtime: {
      ...runtime,
      db: {
        delete: runtime.db.delete.bind(runtime.db),
        execute: runtime.db.execute.bind(runtime.db),
        insert: () => {
          throw new Error("audit store unavailable");
        },
        select: runtime.db.select.bind(runtime.db),
        transaction: runtime.db.transaction.bind(runtime.db),
        update: runtime.db.update.bind(runtime.db),
      },
    },
  });

  for (const path of [ORGANIZATION_PATH, REPORT_PATH]) {
    const response = await request(path, root.token, app);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(eventId);
  }
});
