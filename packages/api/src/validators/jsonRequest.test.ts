import { expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createApiErrorHandler } from "../diagnostics/errorHandler";
import type { SessionEnv } from "../middleware/session";
import { boundRequestBody } from "../worker/requestBody";
import { jsonRequestValidator } from "./jsonRequest";

test("JSON validation normalizes parser errors without masking route errors", async () => {
  const app = new Hono();
  app.post(
    "/",
    jsonRequestValidator(z.strictObject({ value: z.string() })),
    () => {
      throw new HTTPException(400, { message: "Downstream rejection" });
    },
  );

  const malformed = await app.request("/", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(malformed.status).toBe(400);
  expect(malformed.headers.get("Content-Type")).toContain("application/json");
  expect(await malformed.json()).toEqual({ error: "Invalid request" });

  const downstream = await app.request("/", {
    body: JSON.stringify({ value: "valid" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(downstream.status).toBe(400);
  expect(await downstream.text()).toBe("Downstream rejection");
});

test("a streamed body past the ingress ceiling is a 413, not malformed JSON", async () => {
  const app = new Hono<SessionEnv>();
  app.post(
    "/",
    jsonRequestValidator(z.strictObject({ value: z.string() })),
    (c) => c.json({ ok: true }),
  );
  app.onError(createApiErrorHandler(() => {}));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"'));
      controller.enqueue(new TextEncoder().encode("x".repeat(64)));
      controller.close();
    },
  });
  const init: RequestInit & { readonly duplex: "half" } = {
    body,
    duplex: "half",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  };
  const bounded = boundRequestBody(new Request("http://localhost/", init), 32);
  expect(bounded.kind).toBe("request");
  if (bounded.kind !== "request") {
    return;
  }
  const response = await app.fetch(bounded.request);
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "Request body too large" });
});
