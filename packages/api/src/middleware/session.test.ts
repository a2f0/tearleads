import { expect, test } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { Hono } from "hono";
import { createRequireAuth, type SessionEnv } from "./session";

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
