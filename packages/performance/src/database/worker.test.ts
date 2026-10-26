import { expect, mock, test } from "bun:test";
import { probeFixture } from "./probe.testUtils";
import { createProbeHandler } from "./worker";

const token = "a".repeat(64);
const bindings = {
  HYPERDRIVE: { connectionString: "private-connection" },
  PROBE_TOKEN: token,
  PROBE_RUN: "run",
  PROBE_EXPIRES: String(Date.now() + 60_000),
  POSTGRES_COALESCE_WRITES: "true",
  POSTGRES_POOL_MAX: "4",
  POSTGRES_POOL_MAX_USES: "1",
};
const request = (path: string, method = "POST", credential = token) =>
  new Request(`https://probe.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${credential}`,
      "cf-placement": "remote-IAD",
    },
  });

test("unauthorized and expired requests never acquire a database connection", async () => {
  const pool = mock(() => probeFixture());
  const handler = createProbeHandler(pool);
  expect(
    (await handler(request("/probe", "POST", "wrong"), bindings)).status,
  ).toBe(401);
  expect(
    (await handler(request("/probe"), { ...bindings, PROBE_EXPIRES: "0" }))
      .status,
  ).toBe(410);
  expect(pool).not.toHaveBeenCalled();
});

test("readiness does no database work; only POST /probe measures", async () => {
  const pool = mock(() => probeFixture());
  const handler = createProbeHandler(pool);
  expect((await handler(request("/health", "GET"), bindings)).status).toBe(200);
  expect((await handler(request("/probe", "GET"), bindings)).status).toBe(404);
  expect(pool).not.toHaveBeenCalled();
  const response = await handler(request("/probe"), bindings);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.text();
  expect(body).toContain("remote-IAD");
  expect(body).not.toContain(token);
  expect(body).not.toContain("private-connection");
  expect(pool).toHaveBeenCalledTimes(1);
});

test("driver failures do not disclose connection details", async () => {
  const pool = probeFixture();
  pool.connect.mockRejectedValue(new Error("password=private-connection"));
  const response = await createProbeHandler(() => pool)(
    request("/probe"),
    bindings,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).toBe('{"error":"Database probe failed."}');
});
