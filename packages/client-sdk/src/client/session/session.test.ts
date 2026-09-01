import { describe, expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createSqlClient,
  quietLogger,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import { Database } from "../database";
import { createIdentity, type Identity } from "../identity";
import type { Logger } from "../logger";
import { createSession } from "./index";

type TestLogger = {
  log: NonNullable<Logger["log"]>;
  logError: NonNullable<Logger["logError"]>;
};

type FakeSessionApi = Pick<
  ApiClient,
  | "authenticate"
  | "authenticateWithChallenge"
  | "clearWriterProjectionCaches"
  | "destroySession"
  | "getAuthToken"
  | "listSessions"
  | "logout"
  | "registerUser"
  | "setAuthToken"
>;

function createApi(
  overrides: Partial<FakeSessionApi> = {},
): ApiClient & FakeSessionApi {
  let authToken: string | null = null;
  const api: FakeSessionApi = {
    authenticate: async () => null,
    authenticateWithChallenge: async () => null,
    clearWriterProjectionCaches: () => undefined,
    destroySession: async () => null,
    getAuthToken: () => authToken,
    listSessions: async () => null,
    logout: async () => null,
    registerUser: async () => null,
    setAuthToken: (nextAuthToken) => {
      authToken = nextAuthToken;
    },
  };

  return Object.assign(api, overrides) as ApiClient & FakeSessionApi;
}

function createSessionHarness(
  options: {
    api?: (ApiClient & FakeSessionApi) | undefined;
    database?: Database | undefined;
    identity?: Identity | undefined;
    logger?: TestLogger | undefined;
  } = {},
) {
  const logger = options.logger ?? quietLogger;
  const api = options.api ?? createApi();
  const database = options.database ?? new Database();
  const identity =
    options.identity ?? createIdentity({}, () => undefined, logger.log);

  return {
    api,
    database,
    identity,
    session: createSession({
      api,
      database,
      identity,
      log: logger.log,
      logError: logger.logError,
      onUserIdentityAvailable: async () => undefined,
    }),
  };
}

describe("session", () => {
  test("registers the current identity through the api client", async () => {
    const { close, execSql } = await createTestExecSql(
      "session-register-identity-test",
    );
    const containerId = crypto.randomUUID();
    let registerUserCalls = 0;
    const api = createApi({
      registerUser: async (...args) => {
        registerUserCalls += 1;
        return respondToRegistration(args);
      },
    });
    const { identity, session } = createSessionHarness({
      api,
      database: new Database({
        client: createSqlClient(execSql),
        id: "registration-test-db",
      }),
    });

    try {
      await setGeneratedIdentity(identity);
      session.setContainerId(containerId);

      const result = await session.registerIdentity();
      if (!result) {
        throw new Error("Expected registration to succeed");
      }

      expect(registerUserCalls).toBe(1);
      expect(result).toEqual({
        challenge: "a".repeat(64),
        containerId,
        organizationId: expect.any(String),
        userId: expect.any(String),
      });
      expect(session.containerId).toBe(containerId);
      expect(session.defaultOrganizationId).toBe(result.organizationId);
      expect(session.organizationId).toBe(result.organizationId);
      expect(session.userId).toBe(result.userId);
    } finally {
      close();
    }
  });

  test("does not apply registration context after the identity changes", async () => {
    const { close, execSql } = await createTestExecSql(
      "session-register-identity-transition-test",
    );
    let switchIdentity = async () => undefined;
    let capturedRootContainerId: string | null = null;
    let capturedOrganizationId: string | null = null;
    const api = createApi({
      registerUser: async (...args) => {
        capturedOrganizationId = args[1];
        capturedRootContainerId = args[2];
        const response = await respondToRegistration(args);
        await switchIdentity();
        return response;
      },
    });
    const { identity, session } = createSessionHarness({
      api,
      database: new Database({
        client: createSqlClient(execSql),
        id: "registration-transition-test-db",
      }),
    });
    const identityBContext = {
      authToken: "identity-b-token",
      containerId: "identity-b-container",
      defaultOrganizationId: "identity-b-default-organization",
      isAuthenticated: true,
      organizationId: "identity-b-organization",
      userId: "identity-b-user",
    };

    try {
      await setGeneratedIdentity(identity);
      session.setContainerId(crypto.randomUUID());
      switchIdentity = async () => {
        await setGeneratedIdentity(identity);
        session.setContext(identityBContext);
      };

      await expect(session.registerIdentity()).resolves.toBeNull();
      expect(session.snapshot).toEqual(identityBContext);

      // The replacement identity owns the local database now: the stale
      // registration must not have written its bootstrap rows through it.
      if (!capturedRootContainerId || !capturedOrganizationId) {
        throw new Error("Expected captured registration request");
      }
      await expect(
        sqlContainerContentsPersistence.containerExists(
          execSql,
          capturedRootContainerId,
        ),
      ).resolves.toBe(false);
      await expect(
        loadPrincipalPolicyBundle(
          execSql,
          "organization",
          capturedOrganizationId,
        ),
      ).resolves.toBeNull();
    } finally {
      close();
    }
  });

  test("registration logs workflow failures before propagating them", async () => {
    const { close, execSql } = await createTestExecSql(
      "session-register-identity-failure-test",
    );
    const registrationError = new Error("remote registration unavailable");
    const errors: Array<{ cause: unknown; message: string | Error }> = [];
    const api = createApi({
      registerUser: async () => {
        throw registrationError;
      },
    });
    const { identity, session } = createSessionHarness({
      api,
      database: new Database({
        client: createSqlClient(execSql),
        id: "registration-failure-test-db",
      }),
      logger: {
        ...quietLogger,
        logError: (message, cause) => errors.push({ cause, message }),
      },
    });

    try {
      await setGeneratedIdentity(identity);
      session.setContainerId(crypto.randomUUID());

      await expect(session.registerIdentity()).rejects.toThrow(
        "remote registration unavailable",
      );

      expect(errors).toEqual([
        {
          cause: registrationError,
          message: "Identity registration failed",
        },
      ]);
    } finally {
      close();
    }
  });

  test("login authenticates with the current identity and stores the auth token", async () => {
    let authenticateCalls = 0;
    const api = createApi({
      authenticate: async () => {
        authenticateCalls += 1;
        return {
          authenticated: true,
          organizationId: "org-1",
          token: "test-token",
          userId: "user-1",
        };
      },
    });
    const { identity, session } = createSessionHarness({ api });
    await setGeneratedIdentity(identity);

    await expect(session.login()).resolves.toBe(true);

    expect(authenticateCalls).toBe(1);
    expect(session.authToken).toBe("test-token");
    expect(api.getAuthToken()).toBe("test-token");
    expect(session.defaultOrganizationId).toBe("org-1");
    expect(session.isAuthenticated).toBe(true);
    expect(session.organizationId).toBe("org-1");
    expect(session.userId).toBe("user-1");
  });

  test("does not apply authentication context after the identity changes", async () => {
    let switchIdentity = async () => undefined;
    const api = createApi({
      authenticate: async () => {
        await switchIdentity();
        return {
          authenticated: true,
          organizationId: "identity-a-organization",
          token: "identity-a-token",
          userId: "identity-a-user",
        };
      },
    });
    const { identity, session } = createSessionHarness({ api });
    const identityBContext = {
      authToken: "identity-b-token",
      containerId: "identity-b-container",
      defaultOrganizationId: "identity-b-default-organization",
      isAuthenticated: true,
      organizationId: "identity-b-organization",
      userId: "identity-b-user",
    };
    await setGeneratedIdentity(identity);
    switchIdentity = async () => {
      await setGeneratedIdentity(identity);
      session.setContext(identityBContext);
    };

    await expect(session.login()).resolves.toBe(false);
    expect(session.snapshot).toEqual(identityBContext);
    expect(api.getAuthToken()).toBe("identity-b-token");
  });

  test("login fails when authentication returns no token", async () => {
    const api = createApi({ authenticate: async () => null });
    const { identity, session } = createSessionHarness({ api });
    await setGeneratedIdentity(identity);
    session.setAuthToken("stale-token");

    await expect(session.login()).resolves.toBe(false);

    expect(session.authToken).toBeNull();
    expect(api.getAuthToken()).toBeNull();
    expect(session.isAuthenticated).toBe(false);
  });

  test("lists active sessions through the api client", async () => {
    let listSessionsCalls = 0;
    const api = createApi({
      listSessions: async () => {
        listSessionsCalls += 1;
        return {
          sessions: [
            {
              createdAt: "2026-05-22T10:00:00.000Z",
              id: "a".repeat(64),
              ipAddresses: ["198.51.100.10"],
              isCurrent: true,
              lastActiveAt: "2026-05-22T10:05:00.000Z",
              lastActiveIp: "198.51.100.10",
              signingKeyFingerprint: "b".repeat(64),
            },
          ],
        };
      },
    });
    const { session } = createSessionHarness({ api });

    await expect(session.listSessions()).resolves.toEqual([
      {
        createdAt: "2026-05-22T10:00:00.000Z",
        id: "a".repeat(64),
        ipAddresses: ["198.51.100.10"],
        isCurrent: true,
        lastActiveAt: "2026-05-22T10:05:00.000Z",
        lastActiveIp: "198.51.100.10",
        signingKeyFingerprint: "b".repeat(64),
      },
    ]);

    expect(listSessionsCalls).toBe(1);
  });

  test("destroys active sessions through the api client", async () => {
    const destroyedSessionIds: string[] = [];
    const api = createApi({
      destroySession: async (sessionId) => {
        destroyedSessionIds.push(sessionId);
        return { message: "ok" };
      },
    });
    const { session } = createSessionHarness({ api });
    const sessionId = "c".repeat(64);

    await expect(session.destroySession(sessionId)).resolves.toBe(true);

    expect(destroyedSessionIds).toEqual([sessionId]);
  });

  test("remote logout clears the local authenticated session", async () => {
    let logoutCalls = 0;
    const api = createApi({
      logout: async () => {
        logoutCalls += 1;
        return { message: "ok" };
      },
    });
    const { session } = createSessionHarness({ api });
    session.setAuthToken("test-token");
    session.setContext({ isAuthenticated: true });

    await expect(session.logoutRemote()).resolves.toBe(true);

    expect(logoutCalls).toBe(1);
    expect(session.authToken).toBeNull();
    expect(api.getAuthToken()).toBeNull();
    expect(session.isAuthenticated).toBe(false);
  });

  test("remote logout clears the local session when the remote request fails", async () => {
    let logoutCalls = 0;
    const api = createApi({
      logout: async () => {
        logoutCalls += 1;
        return null;
      },
    });
    const { session } = createSessionHarness({ api });
    session.setAuthToken("stale-token");
    session.setContext({ isAuthenticated: true });

    await expect(session.logoutRemote()).resolves.toBe(false);

    expect(logoutCalls).toBe(1);
    expect(session.authToken).toBeNull();
    expect(api.getAuthToken()).toBeNull();
    expect(session.isAuthenticated).toBe(false);
  });

  test("sync mode is enabled by default", () => {
    const { session } = createSessionHarness();
    expect(session.syncEnabled).toBe(true);
  });

  test("setSyncEnabled toggles the flag and notifies subscribers on change", () => {
    const { session } = createSessionHarness();
    let notifications = 0;
    session.subscribe(() => {
      notifications += 1;
    });

    session.setSyncEnabled(false);
    expect(session.syncEnabled).toBe(false);
    expect(notifications).toBe(1);

    session.setSyncEnabled(true);
    expect(session.syncEnabled).toBe(true);
    expect(notifications).toBe(2);
  });

  test("setSyncEnabled is a no-op when the value is unchanged", () => {
    const { session } = createSessionHarness();
    let notifications = 0;
    session.subscribe(() => {
      notifications += 1;
    });

    session.setSyncEnabled(true); // already the default
    expect(session.syncEnabled).toBe(true);
    expect(notifications).toBe(0);
  });

  test("sync mode is independent of auth context changes", () => {
    const { session } = createSessionHarness();
    session.setSyncEnabled(false);
    session.setContext({ isAuthenticated: true, organizationId: "org-1" });
    // Local-only intent survives login; setContext must not reset it.
    expect(session.syncEnabled).toBe(false);
  });
});
