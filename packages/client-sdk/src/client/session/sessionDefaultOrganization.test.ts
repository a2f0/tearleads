import { expect, test } from "bun:test";
import { Tearleads } from "../Tearleads";

test("default organization is stable and distinct from active context", () => {
  const sdk = new Tearleads();
  sdk.session.setContext({
    containerId: "container-1",
    defaultOrganizationId: "personal-org",
    isAuthenticated: true,
    isRoot: false,
    organizationId: "personal-org",
    userId: "user-1",
  });

  const input = sdk.runtime.input();
  expect(input.auth).toEqual({
    rootContainerId: "container-1",
    defaultOrganizationId: "personal-org",
    isAuthenticated: true,
    isRoot: false,
    organizationId: "personal-org",
    userId: "user-1",
  });
  expect("apiClient" in input).toBe(false);
  expect("userId" in input).toBe(false);
  expect("execSql" in input).toBe(false);
  expect("containerId" in input).toBe(false);

  sdk.session.setOrganizationId("shared-org");
  expect(sdk.session.defaultOrganizationId).toBe("personal-org");
  expect(sdk.session.organizationId).toBe("shared-org");
  expect(sdk.runtime.input().auth.defaultOrganizationId).toBe("personal-org");
  expect(sdk.runtime.input().auth.organizationId).toBe("shared-org");
});

test("a local root awaiting reconciliation does not replace session root authority", () => {
  const sdk = new Tearleads();
  sdk.session.setContext({
    containerId: "acknowledged-root",
    organizationId: "org",
    userId: "user",
    isAuthenticated: true,
  });
  sdk.session.setContainerId("local-root-awaiting-reconciliation");
  expect(sdk.runtime.input().auth.rootContainerId).toBe("acknowledged-root");
  expect(sdk.runtime.input().state.containerId).toBe(
    "local-root-awaiting-reconciliation",
  );
  sdk.dispose();
});
