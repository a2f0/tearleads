import { expect, test } from "bun:test";
import { createDomainScope } from "@tearleads/client-sdk";
import {
  captureOrgManagerOperationScope,
  isOrgManagerOperationScopeActive,
} from "./orgManagerOperationScope";

function createRuntime() {
  return {
    auth: {
      isAuthenticated: true,
      organizationId: "org-a",
      userId: "user-a",
    },
    crypto: { signingFingerprint: "signing-a" },
    infra: { dbStatus: "ready" },
    state: {
      containerId: "root-a",
      domainScope: createDomainScope(),
    },
  };
}

test("org-manager operation scope requires a ready database", () => {
  const runtime = createRuntime();
  runtime.infra.dbStatus = "idle";

  expect(captureOrgManagerOperationScope(runtime, {})).toBeNull();
});

test("org-manager operation generation rejects an A to B to A continuation", () => {
  const runtime = createRuntime();
  const generationA1 = {};
  const scopeA1 = captureOrgManagerOperationScope(runtime, generationA1);
  if (!scopeA1) {
    throw new Error("Expected a captured operation scope");
  }

  expect(isOrgManagerOperationScopeActive(scopeA1, runtime, generationA1)).toBe(
    true,
  );
  expect(isOrgManagerOperationScopeActive(scopeA1, runtime, {})).toBe(false);
});
