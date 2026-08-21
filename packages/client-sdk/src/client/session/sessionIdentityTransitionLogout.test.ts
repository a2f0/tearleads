import { expect, test } from "bun:test";
import type { ApiClient } from "@symcrypt/api-client";
import { setGeneratedIdentity } from "../../../test/helpers/clientTestSupport";
import { Database } from "../database";
import { createIdentity } from "../identity";
import { createSession } from "./index";

test("remote logout does not clear a session for a changed identity", async () => {
  let authToken: string | null = null;
  let switchIdentity = async () => undefined;
  const api = {
    getAuthToken: () => authToken,
    logout: async () => {
      await switchIdentity();
      return { message: "ok" };
    },
    setAuthToken: (value: string | null) => {
      authToken = value;
    },
  } as ApiClient;
  const identity = createIdentity(
    {},
    () => undefined,
    () => undefined,
  );
  const session = createSession({
    api,
    database: new Database(),
    identity,
    log: () => undefined,
    logError: () => undefined,
  });
  const identityBContext = {
    authToken: "identity-b-token",
    containerId: "identity-b-container",
    defaultOrganizationId: "identity-b-default-organization",
    isAuthenticated: true,
    organizationId: "identity-b-organization",
    userId: "identity-b-user",
  };
  await setGeneratedIdentity(identity);
  session.setContext({
    authToken: "identity-a-token",
    isAuthenticated: true,
  });
  switchIdentity = async () => {
    await setGeneratedIdentity(identity);
    session.setContext(identityBContext);
  };

  await expect(session.logoutRemote()).resolves.toBe(true);
  expect(session.snapshot).toEqual(identityBContext);
  expect(api.getAuthToken()).toBe("identity-b-token");
});
