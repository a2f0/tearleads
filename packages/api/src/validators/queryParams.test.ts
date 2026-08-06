import { expect, test } from "bun:test";
import { getOrganizationReadModelOperation } from "@tearleads/validators/operation";
import { Hono } from "hono";
import { queryParamsValidator } from "./queryParams";

test("query validation preserves first-value semantics", async () => {
  const app = new Hono();
  app.get(
    "/",
    queryParamsValidator(getOrganizationReadModelOperation.query),
    (c) => c.json(c.req.valid("query")),
  );

  const response = await app.request("/?cursor=first&cursor=second");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ cursor: "first" });
});

test("query validation returns the configured boundary error", async () => {
  const app = new Hono();
  const schema = {
    safeParse: (_value: unknown) => ({ success: false as const }),
  };
  app.get("/", queryParamsValidator(schema, "Invalid page"), (c) =>
    c.text("ok"),
  );

  const response = await app.request("/?page=2");

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid page" });
});

test("query validation can preserve a schema issue message", async () => {
  const app = new Hono();
  const schema = {
    safeParse: (_value: unknown) => ({
      error: { issues: [{ message: "Page is out of range" }] },
      success: false as const,
    }),
  };
  app.get(
    "/",
    queryParamsValidator(
      schema,
      (schemaMessage) => schemaMessage ?? "Invalid page",
    ),
    (c) => c.text("ok"),
  );

  const response = await app.request("/?page=999");

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Page is out of range" });
});
