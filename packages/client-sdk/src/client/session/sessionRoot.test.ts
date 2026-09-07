import { expect, test } from "bun:test";
import { Tearleads } from "../Tearleads";

const ROOT_CONTEXT = {
  authToken: "token-root",
  containerId: "container-1",
  defaultOrganizationId: "personal-org",
  isAuthenticated: true,
  isRoot: true,
  organizationId: "personal-org",
  userId: "user-root",
} as const;

test("the root flag reaches the session snapshot and workflow runtime", () => {
  const sdk = new Tearleads();
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);

  sdk.session.setContext(ROOT_CONTEXT);

  expect(sdk.session.isRoot).toBe(true);
  expect(sdk.session.snapshot.isRoot).toBe(true);
  expect(sdk.runtime.input().auth.isRoot).toBe(true);
  expect(sdk.root.isAvailable).toBe(true);
});

test("a partial context update keeps the root flag until it is cleared", () => {
  const sdk = new Tearleads();
  sdk.session.setContext(ROOT_CONTEXT);

  sdk.session.setContext({ authToken: "token-renewed" });
  expect(sdk.session.isRoot).toBe(true);
  expect(sdk.root.isAvailable).toBe(true);

  sdk.session.setContext({ isRoot: false });
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);
});

test("logout drops the root flag along with the session", () => {
  const sdk = new Tearleads();
  sdk.session.setContext(ROOT_CONTEXT);

  sdk.session.logout();

  expect(sdk.session.isAuthenticated).toBe(false);
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.runtime.input().auth.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);
});

test("the root facade refuses calls without a root session", async () => {
  const sdk = new Tearleads();
  sdk.session.setContext({ ...ROOT_CONTEXT, isRoot: false });

  const outcome = await sdk.root.listIdentities();

  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error("expected a refused outcome");
  }
  expect(outcome.status).toBeNull();
  expect(outcome.message).toContain("not a platform operator");
});
