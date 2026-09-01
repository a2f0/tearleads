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
) {
  const api = new ApiClient("");
  api.authenticate = async () => ({
    authenticated: true,
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
  });
  return { api, session };
}

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
