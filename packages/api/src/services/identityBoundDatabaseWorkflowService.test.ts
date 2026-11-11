import { expect, test } from "bun:test";
import { createIdentityBoundDatabaseWorkflowService } from "./identityBoundDatabaseWorkflowService";
import { getDefaultApiServiceRuntime } from "./runtime";

test("identity-bound service supplies canonical runtime scope, not the incoming host", async () => {
  const service = createIdentityBoundDatabaseWorkflowService(
    async (_db, input: string, identityTrustDomain) => ({
      input,
      identityTrustDomain,
    }),
  );
  const runtime = {
    ...getDefaultApiServiceRuntime(),
    identityTrustDomain: "https://canonical.test/base",
  };
  expect(
    await service(runtime, "request", "https://attacker.test/policy"),
  ).toEqual({
    input: "request",
    identityTrustDomain: "https://canonical.test/base",
  });
});

test("identity-bound service resolves only an explicit development request URL", async () => {
  const service = createIdentityBoundDatabaseWorkflowService(
    async (_db, _input: string, identityTrustDomain) => identityTrustDomain,
  );
  const runtime = {
    ...getDefaultApiServiceRuntime(),
    identityTrustDomain: null,
  };
  expect(
    await service(runtime, "request", "http://localhost:3001/policy"),
  ).toBe("http://localhost:3001");
  await expect(service(runtime, "request")).rejects.toThrow(
    "Identity trust domain requires",
  );
});
