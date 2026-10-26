import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  type RootAuditAction,
  rootAuditEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { protocolOperations } from "@tearleads/validators/operation";
import {
  ROOT_AUDIT_ACTIONS,
  type RootAuditEventResponse,
} from "@tearleads/validators/response";
import { and, desc, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

const root = createTestUser();
const member = createTestUser();
// Suspension revokes sessions, so it targets an identity the other tests skip.
const suspendee = createTestUser();
const OPERATOR_IP = "198.51.100.4";
let memberOrganizationId = "";

function rootRequest(
  path: string,
  app = routeApp,
  method = "GET",
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      headers: {
        Authorization: `Bearer ${root.token}`,
        "x-forwarded-for": OPERATOR_IP,
      },
      method,
    }),
  );
}

// Back-to-back requests can share a clock tick, so a test making two of the
// same action tells them apart by `filter` rather than by time.
async function latestEvent(action: RootAuditAction, filter?: string) {
  const [row] = await db
    .select()
    .from(rootAuditEvents)
    .where(
      and(
        eq(rootAuditEvents.action, action),
        eq(rootAuditEvents.actorUserId, root.userId),
        filter === undefined ? undefined : eq(rootAuditEvents.filter, filter),
      ),
    )
    .orderBy(desc(rootAuditEvents.occurredAt), desc(rootAuditEvents.id))
    .limit(1);
  return row;
}

beforeAll(async () => {
  await registerUser(root);
  await registerUser(member);
  await registerUser(suspendee);
  await authenticate(root);
  await authenticate(member);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, member.userId));
  memberOrganizationId = row?.organizationId ?? "";
  expect(memberOrganizationId).not.toBe("");
});

test("every root operation records who asked for what before it answers", async () => {
  const requests = [
    {
      action: "root.identities.list",
      path: `/root/identities?fingerprint=${member.fingerprint.slice(0, 8)}&rootOnly=true&userId=${member.userId}`,
      expected: {
        filter: `fingerprint=${member.fingerprint.slice(0, 8)}&rootOnly=true&userId=${member.userId}`,
        targetUserId: member.userId,
      },
    },
    {
      action: "root.identities.get",
      path: `/root/identities/${member.userId}`,
      expected: { targetUserId: member.userId },
    },
    {
      action: "root.identities.organizations.list",
      path: `/root/identities/${member.userId}/organizations`,
      expected: { targetUserId: member.userId },
    },
    {
      action: "root.organizations.list",
      path: `/root/organizations?search=%20${memberOrganizationId.toUpperCase()}%20`,
      expected: {
        filter: `search=${memberOrganizationId}`,
        targetOrganizationId: memberOrganizationId,
      },
    },
    {
      action: "root.organizations.get",
      path: `/root/organizations/${memberOrganizationId}`,
      expected: { targetOrganizationId: memberOrganizationId },
    },
    {
      action: "root.organizations.identities.list",
      path: `/root/organizations/${memberOrganizationId}/identities`,
      expected: { targetOrganizationId: memberOrganizationId },
    },
    {
      action: "root.organizations.dataUsage.get",
      path: `/root/organizations/${memberOrganizationId}/data-usage`,
      expected: { targetOrganizationId: memberOrganizationId },
    },
    {
      action: "root.reports.dataUsage.list",
      path: `/root/reports/data-usage?search=${memberOrganizationId}`,
      expected: {
        filter: `search=${memberOrganizationId}`,
        targetOrganizationId: memberOrganizationId,
      },
    },
    {
      action: "root.reports.opsHealth.get",
      path: "/root/reports/ops-health",
      expected: {},
    },
    {
      action: "root.organizations.revenuecatEvents.list",
      path: `/root/organizations/${memberOrganizationId}/revenuecat-events`,
      expected: { targetOrganizationId: memberOrganizationId },
    },
    {
      action: "root.reports.revenuecatEvents.list",
      path: "/root/reports/revenuecat-events?disposition=ignored",
      expected: { filter: "disposition=ignored" },
    },
    {
      action: "root.auditEvents.list",
      path: `/root/audit-events?subjectId=${member.userId}`,
      expected: {
        filter: `subjectId=${member.userId}`,
        targetUserId: member.userId,
      },
    },
    {
      action: "root.identities.suspension.put",
      method: "PUT",
      path: `/root/identities/${suspendee.userId}/suspension`,
      expected: { targetUserId: suspendee.userId },
    },
    {
      action: "root.identities.suspension.delete",
      method: "DELETE",
      path: `/root/identities/${suspendee.userId}/suspension`,
      expected: { targetUserId: suspendee.userId },
    },
  ] as const;

  // A new root operation must join this table, and its action vocabulary.
  const rootOperationIds: string[] = protocolOperations
    .filter((operation) => operation.path.startsWith("/root/"))
    .map((operation) => operation.id)
    .sort();
  const auditedIds: string[] = requests.map((request) => request.action);
  expect(auditedIds.sort()).toEqual(rootOperationIds);
  const actions: string[] = [...ROOT_AUDIT_ACTIONS];
  expect(actions.sort()).toEqual(
    [...rootOperationIds, "root.access.grant", "root.access.revoke"].sort(),
  );

  for (const request of requests) {
    const response = await rootRequest(
      request.path,
      routeApp,
      "method" in request ? request.method : "GET",
    );
    expect(response.status).toBe(200);
    const event = await latestEvent(request.action);
    expect(event).toMatchObject({
      actorUserId: root.userId,
      filter: null,
      sourceIpAddress: OPERATOR_IP,
      targetOrganizationId: null,
      targetUserId: null,
      ...request.expected,
    });
  }
});

test("a full signing key fingerprint is a lookup of the identity it names", async () => {
  const response = await rootRequest(
    `/root/identities?fingerprint=${member.fingerprint}`,
  );
  expect(response.status).toBe(200);
  expect(
    await latestEvent(
      "root.identities.list",
      `fingerprint=${member.fingerprint}`,
    ),
  ).toMatchObject({ targetUserId: member.userId });

  const unregistered = "f".repeat(64);
  const missing = await rootRequest(
    `/root/identities?fingerprint=${unregistered}`,
  );
  expect(missing.status).toBe(200);
  expect(
    await latestEvent("root.identities.list", `fingerprint=${unregistered}`),
  ).toMatchObject({ targetUserId: null });
});

test("viewing a subject's audit trail lands in that subject's trail", async () => {
  const unknown = "33333333-3333-4333-8333-333333333333";
  for (const [subjectId, expected] of [
    [memberOrganizationId, { targetOrganizationId: memberOrganizationId }],
    [unknown, { targetOrganizationId: null, targetUserId: null }],
  ] as const) {
    const response = await rootRequest(
      `/root/audit-events?subjectId=${subjectId}`,
    );
    expect(response.status).toBe(200);
    expect(
      await latestEvent("root.auditEvents.list", `subjectId=${subjectId}`),
    ).toMatchObject(expected);
  }
});

test("an organization search that names no organization ID records no target", async () => {
  for (const [action, path] of [
    ["root.organizations.list", "/root/organizations?search=%20Needle%20"],
    ["root.reports.dataUsage.list", "/root/reports/data-usage?search=needle"],
  ] as const) {
    const response = await rootRequest(path);
    expect(response.status).toBe(200);
    expect(await latestEvent(action)).toMatchObject({
      filter: "search=needle",
      targetOrganizationId: null,
    });
  }
});

test("requests refused before root is established leave no audit event", async () => {
  const before = await db.select().from(rootAuditEvents);
  const response = await routeApp.request(`/root/identities/${root.userId}`, {
    headers: { Authorization: `Bearer ${member.token}` },
  });
  expect(response.status).toBe(403);
  expect(await db.select().from(rootAuditEvents)).toHaveLength(before.length);
});

test("audit events page newest first and narrow to one subject", async () => {
  await db.insert(rootAuditEvents).values({
    action: "root.access.grant",
    actorUserId: null,
    targetUserId: member.userId,
  });
  await rootRequest(`/root/identities/${member.userId}`);
  await rootRequest(`/root/organizations/${memberOrganizationId}`);

  const collected: RootAuditEventResponse[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      limit: "2",
      subjectId: member.userId,
      ...(cursor === null ? {} : { cursor }),
    });
    const response = await rootRequest(`/root/audit-events?${query}`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      events: RootAuditEventResponse[];
      nextCursor: string | null;
    };
    expect(page.events.length).toBeLessThanOrEqual(2);
    collected.push(...page.events);
    cursor = page.nextCursor;
  } while (cursor !== null);

  expect(new Set(collected.map((event) => event.id)).size).toBe(
    collected.length,
  );
  const times = collected.map((event) => Date.parse(event.occurredAt));
  expect([...times].sort((left, right) => right - left)).toEqual(times);
  for (const event of collected) {
    expect([event.actorUserId, event.targetUserId]).toContain(member.userId);
  }
  // The organization lookup names only the organization, so it is excluded.
  expect(
    collected.some((event) => event.action === "root.organizations.get"),
  ).toBe(false);
  expect(collected).toContainEqual(
    expect.objectContaining({
      action: "root.identities.get",
      actorSigningKeyFingerprint: root.fingerprint,
      actorUserId: root.userId,
    }),
  );
  expect(collected).toContainEqual(
    expect.objectContaining({
      action: "root.access.grant",
      actorSigningKeyFingerprint: null,
      actorUserId: null,
    }),
  );
});

test("an invalid audit cursor is a bad request", async () => {
  const response = await rootRequest("/root/audit-events?cursor=not-a-cursor");
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid cursor" });
});

test("a root lookup whose audit event cannot be written is refused", async () => {
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

  const response = await rootRequest(`/root/identities/${member.userId}`, app);

  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain(member.fingerprint);
});
