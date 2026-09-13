import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createSqlClient,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { Database } from "../database";
import { createIdentity } from "../identity";
import { createSession } from "./index";

const USER_ID = "11111111-1111-4111-8111-111111111111";

async function createLoginHarness(
  onUserIdentityAvailable?: (userId: string) => Promise<void>,
  reportSecurityIncident?: (error: unknown, context: unknown) => Promise<void>,
) {
  const api = new ApiClient("");
  api.authenticate = async () => ({
    rootContainerId: null,
    authenticated: true,
    isRoot: false,
    organizationId: "organization-1",
    token: "token-1",
    userId: USER_ID,
  });
  const identity = createIdentity(
    {},
    () => undefined,
    () => undefined,
  );
  await setGeneratedIdentity(identity);
  const session = createSession({
    api,
    database: new Database(),
    identity,
    log: () => undefined,
    logError: () => undefined,
    ...(onUserIdentityAvailable ? { onUserIdentityAvailable } : {}),
    ...(reportSecurityIncident ? { reportSecurityIncident } : {}),
  });
  return { api, identity, session };
}

test("a login refused by acknowledgment mismatch is recorded as an incident", async () => {
  const incidents: Array<{ error: unknown; context: unknown }> = [];
  const { session } = await createLoginHarness(
    async () => undefined,
    async (error, context) => {
      incidents.push({ context, error });
    },
  );
  session.setContext({ userId: "acknowledged-user", isAuthenticated: false });
  await expect(session.login()).rejects.toMatchObject({
    code: "object_mismatch",
  });
  expect(incidents).toHaveLength(1);
  expect(incidents[0]?.error).toMatchObject({ code: "object_mismatch" });
  expect(incidents[0]?.context).toMatchObject({
    objectId: USER_ID,
    objectKind: "user",
    operation: "session.login",
  });
});

test("only a server-acknowledged user ID counts as acknowledged", async () => {
  const { session } = await createLoginHarness(async () => undefined);
  expect(session.userIdAcknowledged).toBe(false);
  session.setUserId("unacknowledged-local-user");
  expect(session.userId).toBe("unacknowledged-local-user");
  expect(session.userIdAcknowledged).toBe(false);
  await expect(session.login()).resolves.toBe(true);
  expect(session.userId).toBe(USER_ID);
  expect(session.userIdAcknowledged).toBe(true);
  session.setUserId("another-local-choice");
  expect(session.userIdAcknowledged).toBe(false);
  session.setUserId(USER_ID);
  expect(session.userIdAcknowledged).toBe(true);
});

test("acknowledging a user ID the snapshot already holds notifies subscribers", async () => {
  const { session } = await createLoginHarness(async () => undefined);
  session.setUserId(USER_ID);
  expect(session.userIdAcknowledged).toBe(false);
  const observed: boolean[] = [];
  session.subscribe(() => {
    observed.push(session.userIdAcknowledged);
  });
  session.setContext({ userId: USER_ID });
  expect(session.userId).toBe(USER_ID);
  expect(observed).toEqual([true]);
  session.setContext({ userId: USER_ID });
  expect(observed).toEqual([true]);
});

test("login rejects a user ID different from the restored acknowledged session", async () => {
  const pinned: string[] = [];
  const { api, session } = await createLoginHarness(async (userId) => {
    pinned.push(userId);
  });
  session.setContext({ userId: "acknowledged-user", isAuthenticated: false });
  await expect(session.login()).rejects.toMatchObject({
    code: "object_mismatch",
  });
  expect(pinned).toEqual([]);
  expect(session.userId).toBe("acknowledged-user");
  expect(session.isAuthenticated).toBe(false);
  expect(api.getAuthToken()).toBeNull();
});

test("logout retains the acknowledged identity binding for the next login", async () => {
  const { api, session } = await createLoginHarness(async () => undefined);
  await expect(session.login()).resolves.toBe(true);
  session.logout();
  api.authenticate = async () => ({
    authenticated: true,
    isRoot: false,
    organizationId: "organization-1",
    rootContainerId: "root-1",
    token: "other-token",
    userId: "other-user",
  });
  await expect(session.login()).rejects.toMatchObject({
    code: "object_mismatch",
  });
  expect(session.userId).toBe(USER_ID);
});

test("a new identity and an unacknowledged local user choice do not bind login", async () => {
  const { identity, session } = await createLoginHarness(async () => undefined);
  session.setUserId("unacknowledged-local-user");
  await expect(session.login()).resolves.toBe(true);
  await setGeneratedIdentity(identity);
  session.setUserId("previous-identity-user");
  await expect(session.login()).resolves.toBe(true);
});

test("login fails before authentication without an identity trust service", async () => {
  const { api, session } = await createLoginHarness();
  let authenticationCalls = 0;
  api.authenticate = async () => {
    authenticationCalls += 1;
    return null;
  };

  await expect(session.login()).rejects.toMatchObject({
    code: "missing_dependency",
  });
  expect(authenticationCalls).toBe(0);
  expect(session.isAuthenticated).toBe(false);
});

test("login waits for the authoritative local identity trust check", async () => {
  const checkedUserIds: string[] = [];
  const { session } = await createLoginHarness(async (userId) => {
    checkedUserIds.push(userId);
  });

  await expect(session.login()).resolves.toBe(true);
  expect(checkedUserIds).toEqual([USER_ID]);
  expect(session.isAuthenticated).toBe(true);
});

test("login propagates identity mismatch and clears authentication", async () => {
  const mismatch = new KeyingVerificationError(
    "equivocation",
    "Local identity does not match its durable pin",
  );
  const { api, session } = await createLoginHarness(async () => {
    throw mismatch;
  });
  const publishedUserIds: Array<string | null> = [];
  session.subscribe(() => {
    publishedUserIds.push(session.userId);
  });

  await expect(session.login()).rejects.toBe(mismatch);
  expect(session.authToken).toBeNull();
  expect(api.getAuthToken()).toBeNull();
  expect(session.isAuthenticated).toBe(false);
  expect(publishedUserIds).not.toContain(USER_ID);
});

test("registration does not publish server context before local identity trust", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-identity-trust-publication",
  );
  const api = new ApiClient("");
  api.registerUser = async (...args) => respondToRegistration(args);
  const identity = createIdentity(
    {},
    () => undefined,
    () => undefined,
  );
  await setGeneratedIdentity(identity);
  const mismatch = new KeyingVerificationError(
    "equivocation",
    "Local identity does not match its durable pin",
  );
  const session = createSession({
    api,
    database: new Database({
      client: createSqlClient(execSql),
      id: "registration-identity-trust-publication",
    }),
    identity,
    log: () => undefined,
    logError: () => undefined,
    onUserIdentityAvailable: async () => {
      throw mismatch;
    },
  });
  session.setContainerId(crypto.randomUUID());
  const publishedUserIds: Array<string | null> = [];
  session.subscribe(() => {
    publishedUserIds.push(session.userId);
  });

  try {
    await expect(session.registerIdentity()).rejects.toBe(mismatch);
    expect(session.userId).toBeNull();
    expect(session.organizationId).toBeNull();
    expect(publishedUserIds).toEqual([]);
  } finally {
    close();
  }
});

test("a host acknowledgment during login pinning rejects authentication and clears its token", async () => {
  const harness = await createLoginHarness(async () => {
    harness.session.setContext({ userId: "restored-during-pin" });
  });
  harness.session.setContext({
    authToken: "prior-token",
    isAuthenticated: true,
  });
  await expect(harness.session.login()).rejects.toMatchObject({
    code: "object_mismatch",
  });
  expect(harness.session.userId).toBe("restored-during-pin");
  expect(harness.session.isAuthenticated).toBe(false);
  expect(harness.api.getAuthToken()).toBeNull();
});
