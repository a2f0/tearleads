import { afterEach, expect, test } from "bun:test";
import { startApiServer } from "./apiServer";
import { trace } from "./trace";

const httpSinkKey = "__tearleadsPerfScenarioHttpSink";
const opSinkKey = "__tearleadsPerfScenarioOpSink";

afterEach(() => {
  Reflect.deleteProperty(globalThis, httpSinkKey);
  Reflect.deleteProperty(globalThis, opSinkKey);
});

test("apiServer and trace forward to opt-in scenario profiling sinks", async () => {
  const observedHttp: unknown[] = [];
  const observedOps: string[] = [];
  Reflect.set(globalThis, httpSinkKey, (obs: unknown) => {
    observedHttp.push(obs);
  });
  Reflect.set(globalThis, opSinkKey, (message: string) => {
    observedOps.push(message);
  });

  trace("removeFromGroup");
  expect(observedOps).toEqual(["removeFromGroup"]);

  const origin = await startApiServer();
  const response = await fetch(`${origin}/auth/challenge`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
      "x-known-manifests": "m1, m2",
    },
    body: JSON.stringify({ userId: "nonexistent-user" }),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(observedHttp).toHaveLength(1);
  expect(observedHttp[0]).toMatchObject({
    authorization: "Bearer test-token",
    knownManifestsCount: 2,
    method: "POST",
    status: response.status,
    url: `${origin}/auth/challenge`,
  });
});
