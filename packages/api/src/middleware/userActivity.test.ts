import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { users, userTwoFactor } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createRequireAuth, type SessionEnv } from "./session";
import {
  createRecordActivityUnlessSuspended,
  sessionStandingRefusal,
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

const notSuspended = {
  suspended: false,
  twoFactorEnabled: false,
  twoFactorRequiredOrganizationIds: [],
};

async function readLastActiveAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastActiveAt: users.lastActiveAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.lastActiveAt ?? null;
}

test("the standing stamp moves an active user's last_active_at forward only", async () => {
  const userId = await insertUser();
  const record = createRecordActivityUnlessSuspended(db);
  const later = Date.UTC(2026, 8, 6, 12, 0, 0);

  await expect(record({ lastActiveAt: later, userId })).resolves.toEqual(
    notSuspended,
  );
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));
  await expect(
    record({ lastActiveAt: later - 60_000, userId }),
  ).resolves.toEqual(notSuspended);
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));
  await expect(
    record({ lastActiveAt: later + 1_000, userId }),
  ).resolves.toEqual(notSuspended);
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

  await expect(
    record({ lastActiveAt: seen + 60_000, userId }),
  ).resolves.toMatchObject({
    suspended: true,
  });
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(seen));
});

test("once two-factor is on, only a session that passed it stands", async () => {
  const userId = await insertUser();
  const record = createRecordActivityUnlessSuspended(db);
  const session = (twoFactorVerified: boolean) => ({
    twoFactorRequiredOrganizationIds: [],
    twoFactorVerified,
  });
  await db.insert(userTwoFactor).values({
    secretCiphertext: "sealed",
    userId,
  });
  const pending = await record({ lastActiveAt: Date.now(), userId });
  expect(pending.twoFactorEnabled).toBe(false);
  expect(sessionStandingRefusal(session(false), pending)).toBeNull();

  await db
    .update(userTwoFactor)
    .set({ enabledAt: new Date() })
    .where(eq(userTwoFactor.userId, userId));
  const enabled = await record({ lastActiveAt: Date.now(), userId });
  expect(enabled.twoFactorEnabled).toBe(true);
  expect(sessionStandingRefusal(session(false), enabled)).toBe(
    "Two-factor sign-in required",
  );
  expect(sessionStandingRefusal(session(true), enabled)).toBeNull();
});

test("the standing stamp reads an unknown user as not suspended", async () => {
  await expect(
    createRecordActivityUnlessSuspended(db)({
      lastActiveAt: Date.now(),
      userId: "00000000-0000-4000-8000-000000000000",
    }),
  ).resolves.toEqual(notSuspended);
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
          twoFactorRequiredOrganizationIds: [],
          twoFactorVerified: false,
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
