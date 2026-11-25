import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import {
  noIdentityChange,
  setGeneratedIdentity,
} from "../../../test/helpers/data/clientTestSupport";
import { createIdentity } from "../identity";
import { Database } from "../runtime/database";
import { createSession } from "./index";

test.each(["same", "changed"])(
  "pending remote logout preserves a replacement sign-in with the %s identity",
  async (selection) => {
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
    const identity = createIdentity({}, noIdentityChange, () => undefined);
    const session = createSession({
      identityTrustDomain: "https://api.example.test",
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
      isRoot: false,
      rootAcknowledgments: [],
      organizationId: "identity-b-organization",
      twoFactorDeviceToken: null,
      userId: "identity-b-user",
    };
    await setGeneratedIdentity(identity);
    session.setContext({
      authToken: "identity-a-token",
      isAuthenticated: true,
    });
    switchIdentity = async () => {
      if (selection === "changed") await setGeneratedIdentity(identity);
      session.setContext(identityBContext);
    };

    let cleanup = 0;
    await expect(
      session.logoutRemote(() => {
        cleanup++;
      }),
    ).resolves.toBe(true);
    expect(cleanup).toBe(0);
    expect(session.snapshot).toEqual(identityBContext);
    expect(api.getAuthToken()).toBe("identity-b-token");
  },
);

test("a concurrent renewal refusal preserves confirmed local logout cleanup", async () => {
  const release = Promise.withResolvers<{ message: string }>();
  const identity = createIdentity({}, noIdentityChange, () => {});
  const session = createSession({
    api: {
      logout: () => release.promise,
      setAuthToken: () => {},
    } as unknown as ApiClient,
    identityTrustDomain: "https://api.example.test",
    database: new Database(),
    identity,
    log: () => {},
    logError: () => {},
  });
  session.setContext({ isAuthenticated: true, authToken: "old" });
  let cleaned = false;
  const pending = session.logoutRemote((current) => {
    cleaned = current();
  });
  await session.renewExpired();
  expect(session.isAuthenticated).toBe(false);
  release.resolve({ message: "ok" });
  await pending;
  expect(cleaned).toBe(true);
});
