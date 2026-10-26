import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { rootAuditEvents, users } from "@tearleads/api-shared/schema";
import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { and, eq } from "drizzle-orm";
import { requestChallenge, submitVerify } from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { get, setKeepTtl } from "../../adapters/keyValueStore";
import { isLiveUserSession, listUserSessions } from "../../middleware/session";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

const root = createTestUser();
const otherRoot = createTestUser();
const member = createTestUser();
const MISSING_USER_ID = "00000000-0000-4000-8000-000000000000";

function suspension(
  userId: string,
  method: "DELETE" | "PUT",
  app = routeApp,
): Promise<Response> {
  return Promise.resolve(
    app.request(`/root/identities/${userId}/suspension`, {
      headers: { Authorization: `Bearer ${root.token}` },
      method,
    }),
  );
}

async function signIn(user: TestUser): Promise<Response> {
  const challengeResponse = await requestChallenge(user.fingerprint);
  expect(challengeResponse.status).toBe(200);
  const { challenge } = (await challengeResponse.json()) as {
    challenge: string;
  };
  return submitVerify(
    user.fingerprint,
    sign(
      authChallengeSigningBytes({
        apiOrigin: "http://localhost",
        challengeHex: challenge,
        fingerprint: user.fingerprint,
      }),
      user.signing.signingPrivateKey,
    ),
  );
}

function sessionStatus(token: string | undefined): Promise<number> {
  return Promise.resolve(
    routeApp.request("/auth/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ).then((response) => response.status);
}

async function suspendedAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.suspendedAt ?? null;
}

beforeAll(async () => {
  for (const user of [root, otherRoot, member]) {
    await registerUser(user);
    await authenticate(user);
  }
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
  await db
    .update(users)
    .set({ isRoot: true })
    .where(eq(users.id, otherRoot.userId));
});

test("suspension signs out every device and refuses sign-in until lifted", async () => {
  const firstToken = member.token;
  await authenticate(member);
  const secondToken = member.token;
  expect(await sessionStatus(firstToken)).toBe(200);
  expect(await sessionStatus(secondToken)).toBe(200);

  const suspended = await suspension(member.userId, "PUT");
  expect(suspended.status).toBe(200);
  const body = (await suspended.json()) as {
    identity: { suspendedAt: string | null; userId: string };
  };
  expect(body.identity.userId).toBe(member.userId);
  expect(body.identity.suspendedAt).not.toBeNull();

  expect(await sessionStatus(firstToken)).toBe(401);
  expect(await sessionStatus(secondToken)).toBe(401);
  const refused = await signIn(member);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({
    authenticated: false,
    code: "account_suspended",
    error: "Account suspended",
  });

  const detail = await routeApp.request(`/root/identities/${member.userId}`, {
    headers: { Authorization: `Bearer ${root.token}` },
  });
  expect(await detail.json()).toMatchObject({
    identity: { suspendedAt: body.identity.suspendedAt },
    sessions: [],
  });

  const lifted = await suspension(member.userId, "DELETE");
  expect(lifted.status).toBe(200);
  expect(await lifted.json()).toMatchObject({
    identity: { suspendedAt: null, userId: member.userId },
  });
  expect((await signIn(member)).status).toBe(200);
});

test("repeating a suspension keeps its original time", async () => {
  expect((await suspension(member.userId, "PUT")).status).toBe(200);
  const first = await suspendedAt(member.userId);
  expect(first).not.toBeNull();

  expect((await suspension(member.userId, "PUT")).status).toBe(200);
  expect(await suspendedAt(member.userId)).toEqual(first);

  expect((await suspension(member.userId, "DELETE")).status).toBe(200);
  await authenticate(member);
});

test("root identities, the operator's own included, cannot be suspended", async () => {
  for (const target of [otherRoot, root]) {
    const response = await suspension(target.userId, "PUT");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Root identities cannot be suspended; revoke root with the API CLI first",
    });
    expect(await suspendedAt(target.userId)).toBeNull();
    // The refused attempt is still on the trail.
    expect(
      await db
        .select()
        .from(rootAuditEvents)
        .where(
          and(
            eq(rootAuditEvents.action, "root.identities.suspension.put"),
            eq(rootAuditEvents.targetUserId, target.userId),
          ),
        ),
    ).toHaveLength(1);
  }
  expect(await sessionStatus(otherRoot.token)).toBe(200);
});

test("suspension answers 404 for an unknown identity", async () => {
  for (const method of ["PUT", "DELETE"] as const) {
    const response = await suspension(MISSING_USER_ID, method);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "User not found" });
  }
});

test("only root may suspend", async () => {
  const response = await routeApp.request(
    `/root/identities/${otherRoot.userId}/suspension`,
    {
      headers: { Authorization: `Bearer ${member.token}` },
      method: "PUT",
    },
  );
  expect(response.status).toBe(403);
});

test("a suspension whose audit event cannot be written changes nothing", async () => {
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

  const response = await suspension(member.userId, "PUT", app);

  expect(response.status).toBe(500);
  expect(await suspendedAt(member.userId)).toBeNull();
  expect(await sessionStatus(member.token)).toBe(200);
});

// Moves the session's last activity a minute and more into the past, as if
// its holder had paused, so its next request takes the throttled path.
async function ageSession(token: string | undefined): Promise<void> {
  const key = `session:${token}`;
  const raw = await get(key);
  if (!raw) throw new Error("expected a stored session");
  await setKeepTtl(
    key,
    JSON.stringify({ ...JSON.parse(raw), lastActiveAt: Date.now() - 120_000 }),
  );
}

test("a session a failed sweep missed is refused on its next throttled request", async () => {
  const app = createRouteApp({
    destroyUserSession: async () => {
      throw new Error("session store unavailable");
    },
  });

  const response = await suspension(member.userId, "PUT", app);

  expect(response.status).toBe(500);
  expect(await suspendedAt(member.userId)).not.toBeNull();
  await ageSession(member.token);
  const refused = await routeApp.request("/auth/sessions", {
    headers: { Authorization: `Bearer ${member.token}` },
  });
  expect(refused.status).toBe(401);
  expect(await refused.json()).toMatchObject({
    code: "session_refresh_required",
  });

  expect((await suspension(member.userId, "DELETE")).status).toBe(200);
  await authenticate(member);
});

test("websocket liveness refuses a session a failed sweep missed", async () => {
  const [live] = await listUserSessions({
    currentToken: "",
    userId: member.userId,
  });
  if (!live) throw new Error("expected a live member session");
  const identity = { sessionId: live.id, userId: member.userId };
  expect(await isLiveUserSession(identity)).toBe(true);
  const app = createRouteApp({
    destroyUserSession: async () => {
      throw new Error("session store unavailable");
    },
  });

  expect((await suspension(member.userId, "PUT", app)).status).toBe(500);
  expect(await isLiveUserSession(identity)).toBe(false);

  expect((await suspension(member.userId, "DELETE")).status).toBe(200);
  expect(await isLiveUserSession(identity)).toBe(true);
});
