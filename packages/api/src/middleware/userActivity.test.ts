import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createRequireAuth, type SessionEnv } from "./session";
import {
  createRecordActivityUnlessSuspended,
  createRecordUserActivity,
} from "./userActivity";

async function insertUser(): Promise<string> {
  const [inserted] = await db
    .insert(users)
    .values({
      defaultOrganizationId: crypto.randomUUID(),
      encapsulationKeyFingerprint: crypto.randomUUID().replaceAll("-", ""),
      encapsulationPublicKey: "kem",
      fingerprint: `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
        "-",
        "",
      ),
      signingPublicKey: "signing",
    })
    .returning({ id: users.id });
  if (!inserted) {
    throw new Error("expected inserted user");
  }
  return inserted.id;
}

async function readLastActiveAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastActiveAt: users.lastActiveAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.lastActiveAt ?? null;
}

test("recording user activity only moves last_active_at forward", async () => {
  const userId = await insertUser();
  const recordUserActivity = createRecordUserActivity(db);
  const later = Date.UTC(2026, 8, 6, 12, 0, 0);
  const earlier = later - 60_000;

  await expect(readLastActiveAt(userId)).resolves.toBeNull();

  await recordUserActivity({ lastActiveAt: later, userId });
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));

  await recordUserActivity({ lastActiveAt: earlier, userId });
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));

  await recordUserActivity({ lastActiveAt: later + 1_000, userId });
  await expect(readLastActiveAt(userId)).resolves.toEqual(
    new Date(later + 1_000),
  );
});

test("recording activity for an unknown user is a no-op", async () => {
  const recordUserActivity = createRecordUserActivity(db);
  await expect(
    recordUserActivity({
      lastActiveAt: Date.now(),
      userId: "00000000-0000-4000-8000-000000000000",
    }),
  ).resolves.toBeUndefined();
});

test("the standing stamp moves an active user's last_active_at forward only", async () => {
  const userId = await insertUser();
  const record = createRecordActivityUnlessSuspended(db);
  const later = Date.UTC(2026, 8, 6, 12, 0, 0);

  await expect(record({ lastActiveAt: later, userId })).resolves.toBe(false);
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));
  await expect(record({ lastActiveAt: later - 60_000, userId })).resolves.toBe(
    false,
  );
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));
  await expect(record({ lastActiveAt: later + 1_000, userId })).resolves.toBe(
    false,
  );
  await expect(readLastActiveAt(userId)).resolves.toEqual(
    new Date(later + 1_000),
  );
});

test("the standing stamp reports a suspended user and leaves its activity", async () => {
  const userId = await insertUser();
  const record = createRecordActivityUnlessSuspended(db);
  const seen = Date.UTC(2026, 8, 6, 12, 0, 0);
  await record({ lastActiveAt: seen, userId });
  await db
    .update(users)
    .set({ suspendedAt: new Date(seen + 1_000) })
    .where(eq(users.id, userId));

  await expect(record({ lastActiveAt: seen + 60_000, userId })).resolves.toBe(
    true,
  );
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(seen));
});

test("the standing stamp reads an unknown user as not suspended", async () => {
  await expect(
    createRecordActivityUnlessSuspended(db)({
      lastActiveAt: Date.now(),
      userId: "00000000-0000-4000-8000-000000000000",
    }),
  ).resolves.toBe(false);
});

test("an activity-due authenticated request runs one statement", async () => {
  const userId = await insertUser();
  const token = "e".repeat(64);
  const app = new Hono<SessionEnv>();
  app.use(
    "*",
    createRequireAuth(
      async () =>
        JSON.stringify({
          createdAt: 0,
          fingerprint: "c".repeat(64),
          id: "d".repeat(64),
          ipAddresses: [],
          lastActiveAt: 0,
          lastActiveIp: null,
          userId,
        }),
      async () => undefined,
      createRecordActivityUnlessSuspended(db),
    ),
  );
  app.get("/", (context) => context.json({ ok: true }));
  const counter = { statements: 0 };

  const response = await withDatabaseStatementCounter(counter, () =>
    app.request("/", { headers: { Authorization: `Bearer ${token}` } }),
  );

  expect(response.status).toBe(200);
  // The standing read and the activity stamp were two statements.
  expect(counter.statements).toBe(1);
  expect(await readLastActiveAt(userId)).not.toBeNull();
});
