import { expect, spyOn, test } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { Hono } from "hono";
import {
  createRequireAuth,
  createSessionTokenIssuer,
  type SessionEnv,
} from "./session";

const TOKEN = "a".repeat(64);

function sessionApp(storedSession: string | null) {
  const app = new Hono<SessionEnv>();
  app.use(
    "*",
    createRequireAuth(
      async () => storedSession,
      async () => undefined,
    ),
  );
  app.get("/", (context) => context.json({ ok: true }));
  return app;
}

test("missing bearer credentials remain an uncoded terminal 401", async () => {
  const response = await sessionApp(null).request("/");

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("missing and invalid stored sessions request refresh with a stable code", async () => {
  for (const storedSession of [null, "not-json", "{}"] as const) {
    const response = await sessionApp(storedSession).request("/", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: SESSION_ERROR_CODES.refreshRequired,
    });
  }
});

const ACTIVE_USER_ID = "33333333-3333-4333-8333-333333333333";

function storedSessionJson(lastActiveAt: number): string {
  return JSON.stringify({
    createdAt: lastActiveAt,
    fingerprint: "c".repeat(64),
    id: "d".repeat(64),
    ipAddresses: [],
    lastActiveAt,
    lastActiveIp: null,
    userId: ACTIVE_USER_ID,
  });
}

function activityApp(
  storedSession: string,
  recordUserActivity: Parameters<typeof createRequireAuth>[2],
) {
  const app = new Hono<SessionEnv>();
  app.use(
    "*",
    createRequireAuth(
      async () => storedSession,
      async () => undefined,
      recordUserActivity,
    ),
  );
  app.get("/", (context) => context.json({ ok: true }));
  return app;
}

test("records user activity when the session's activity advances", async () => {
  const recorded: { lastActiveAt: number; userId: string }[] = [];
  const before = Date.now();
  const response = await activityApp(storedSessionJson(0), async (input) => {
    recorded.push(input);
  }).request("/", { headers: { Authorization: `Bearer ${TOKEN}` } });

  expect(response.status).toBe(200);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]?.userId).toBe(ACTIVE_USER_ID);
  expect(recorded[0]?.lastActiveAt).toBeGreaterThanOrEqual(before);
});

test("does not record user activity while the session is fresh", async () => {
  const recorded: unknown[] = [];
  const response = await activityApp(
    storedSessionJson(Date.now()),
    async (input) => {
      recorded.push(input);
    },
  ).request("/", { headers: { Authorization: `Bearer ${TOKEN}` } });

  expect(response.status).toBe(200);
  expect(recorded).toEqual([]);
});

test("a failing activity recorder does not fail the request", async () => {
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await activityApp(storedSessionJson(0), async () => {
      throw new Error("database unavailable");
    }).request("/", { headers: { Authorization: `Bearer ${TOKEN}` } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(consoleError).toHaveBeenCalledTimes(1);
  } finally {
    consoleError.mockRestore();
  }
});

test("issuing a session records the login as user activity", async () => {
  const recorded: { lastActiveAt: number; userId: string }[] = [];
  const createSession = createSessionTokenIssuer(
    async () => undefined,
    async () => undefined,
    async () => undefined,
    async (input) => {
      recorded.push(input);
    },
  );

  const { sessionId, token } = await createSession({
    createdAt: 1_700_000_000_000,
    fingerprint: "c".repeat(64),
    userId: ACTIVE_USER_ID,
  });

  expect(token).toHaveLength(64);
  expect(sessionId).toHaveLength(64);
  expect(sessionId).not.toBe(token);
  expect(recorded).toEqual([
    { lastActiveAt: 1_700_000_000_000, userId: ACTIVE_USER_ID },
  ]);
});

function standingApp(
  storedSession: string,
  isUserSuspended: (userId: string) => Promise<boolean>,
) {
  const app = new Hono<SessionEnv>();
  app.use(
    "*",
    createRequireAuth(
      async () => storedSession,
      async () => undefined,
      undefined,
      isUserSuspended,
    ),
  );
  app.get("/", (context) => context.json({ ok: true }));
  app.onError((_error, context) => context.json({ error: "failed" }, 500));
  return app;
}

test("the throttled activity path refuses a suspended user's session", async () => {
  const checked: string[] = [];
  const response = await standingApp(storedSessionJson(0), async (userId) => {
    checked.push(userId);
    return true;
  }).request("/", { headers: { Authorization: `Bearer ${TOKEN}` } });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    code: SESSION_ERROR_CODES.refreshRequired,
    error: "Account suspended",
  });
  expect(checked).toEqual([ACTIVE_USER_ID]);
});

test("a failing standing check fails the request instead of admitting it", async () => {
  const response = await standingApp(storedSessionJson(0), async () => {
    throw new Error("database unavailable");
  }).request("/", { headers: { Authorization: `Bearer ${TOKEN}` } });

  expect(response.status).toBe(500);
});

test("a fresh session skips the standing check", async () => {
  let checks = 0;
  const response = await standingApp(
    storedSessionJson(Date.now()),
    async () => {
      checks += 1;
      return true;
    },
  ).request("/", { headers: { Authorization: `Bearer ${TOKEN}` } });

  expect(response.status).toBe(200);
  expect(checks).toBe(0);
});
