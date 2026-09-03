import { expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
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
