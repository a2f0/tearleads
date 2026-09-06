import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createRequireRoot } from "./root";
import type { SessionEnv } from "./session";

const ROOT_USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

function rootApp(sessionUserId: string | null) {
  const app = new Hono<SessionEnv>();
  app.use("*", async (c, next) => {
    if (sessionUserId !== null) {
      c.set("session", {
        createdAt: 0,
        fingerprint: "a".repeat(64),
        id: "b".repeat(64),
        ipAddresses: [],
        lastActiveAt: 0,
        lastActiveIp: null,
        userId: sessionUserId,
      });
    }
    await next();
  });
  app.use(
    "*",
    createRequireRoot(async (userId) => userId === ROOT_USER_ID),
  );
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

test("requireRoot rejects requests that carry no session", async () => {
  const response = await rootApp(null).request("/");

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("requireRoot forbids authenticated identities that are not root", async () => {
  const response = await rootApp(OTHER_USER_ID).request("/");

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Forbidden" });
});

test("requireRoot admits root identities", async () => {
  const response = await rootApp(ROOT_USER_ID).request("/");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
