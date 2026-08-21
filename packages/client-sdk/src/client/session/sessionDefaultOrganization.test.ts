import { expect, test } from "bun:test";
import { SymCrypt } from "../SymCrypt";

test("default organization is stable and distinct from active context", () => {
  const sdk = new SymCrypt();
  sdk.session.setContext({
    containerId: "container-1",
    defaultOrganizationId: "personal-org",
    isAuthenticated: true,
    organizationId: "personal-org",
    userId: "user-1",
  });

  const input = sdk.runtime.input();
  expect(input.auth).toEqual({
    defaultOrganizationId: "personal-org",
    isAuthenticated: true,
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
