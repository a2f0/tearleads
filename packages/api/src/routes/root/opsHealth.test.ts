import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { rootAuditEvents, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { RootOpsHealthReportResponseSchema } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

const root = createTestUser();
const member = createTestUser();
const PATH = "/root/reports/ops-health";
const ACTION = "root.reports.opsHealth.get";

function request(token: string | null, app = routeApp) {
  return Promise.resolve(
    app.request(PATH, {
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    }),
  );
}

async function auditCount(actorUserId: string): Promise<number> {
  const rows = await db
    .select({ id: rootAuditEvents.id })
    .from(rootAuditEvents)
    .where(
      and(
        eq(rootAuditEvents.action, ACTION),
        eq(rootAuditEvents.actorUserId, actorUserId),
      ),
    );
  return rows.length;
}

beforeAll(async () => {
  await registerUser(root);
  await registerUser(member);
  await authenticate(root);
  await authenticate(member);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
});

test("the ops-health report needs a session", async () => {
  expect((await request(null)).status).toBe(401);
});

test("a non-root session is refused and records nothing", async () => {
  const response = await request(member.token);
  expect(response.status).toBe(403);
  expect(await auditCount(member.userId)).toBe(0);
});

test("a root session gets the report, and the request is audited", async () => {
  const before = await auditCount(root.userId);
  const response = await request(root.token);
  expect(response.status).toBe(200);
  expect(
    RootOpsHealthReportResponseSchema.safeParse(await response.json()).success,
  ).toBe(true);
  expect(await auditCount(root.userId)).toBe(before + 1);
});

test("the report is not served when its audit event cannot be written", async () => {
  const runtime = getDefaultApiServiceRuntime();
  let reportRead = false;
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
        transaction: ((...args: Parameters<typeof runtime.db.transaction>) => {
          reportRead = true;
          return runtime.db.transaction(...args);
        }) as typeof runtime.db.transaction,
        update: runtime.db.update.bind(runtime.db),
      },
    },
  });

  expect((await request(root.token, app)).status).toBe(500);
  expect(reportRead).toBe(false);
});
