import { describe, expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { createResponseFromRequest } from "../../test/helpers/documentFixtures";
import type { ExecSql, ExecSqlClientLike } from "../sqlite";
import { Database } from "./database";
import { createIdentity, type Identity } from "./identity";
import type { Logger } from "./logger";
import { createSession } from "./session";

type TestLogger = {
  log: NonNullable<Logger["log"]>;
  logError: NonNullable<Logger["logError"]>;
};

const quietLogger: TestLogger = {
  log: () => undefined,
  logError: () => undefined,
};

type FakeSessionApi = Pick<
  ApiClient,
  | "authenticate"
  | "authenticateWithChallenge"
  | "destroySession"
  | "getAuthToken"
  | "listSessions"
  | "logout"
  | "registerUser"
  | "setAuthToken"
>;

function createSqlClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

function createApi(
  overrides: Partial<FakeSessionApi> = {},
): ApiClient & FakeSessionApi {
  let authToken: string | null = null;
  const api: FakeSessionApi = {
    authenticate: async () => null,
    authenticateWithChallenge: async () => null,
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
      registerUser: async (
        userId,
        organizationId,
        rootContainerId,
        _signingPublicKey,
        _encapsulationPublicKey,
        _initialAdminGroup,
        _initialMemberGroup,
        _initialOrganizationPolicy,
        _initialRootContainer,
        initialRootMetadataDocument,
        _initialRosterProfileContainer,
        _initialRosterProfileDocument,
      ) => {
        registerUserCalls += 1;
        const rootMetadataDocument = await createResponseFromRequest(
          initialRootMetadataDocument,
        );

        return {
          challenge: "a".repeat(64),
          organizationId,
          rootContainerId,
          rootMetadataAccessEpoch: 1,
          rootMetadataAccessStateHash:
            rootMetadataDocument.accessManifest.manifestHash,
          rootMetadataDocument,
          rootMetadataDocumentId: rootMetadataDocument.id,
          userId,
        };
      },
    });
    const { identity, session } = createSessionHarness({
      api,
      database: new Database({
        client: createSqlClient(execSql),
        id: "registration-test-db",
        status: "ready",
      }),
    });

    try {
      await identity.generate();
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
      expect(session.organizationId).toBe(result.organizationId);
      expect(session.userId).toBe(result.userId);
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
        status: "ready",
      }),
      logger: {
        ...quietLogger,
        logError: (message, cause) => errors.push({ cause, message }),
      },
    });

    try {
      await identity.generate();
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
        return "test-token";
      },
    });
    const { identity, session } = createSessionHarness({ api });
    await identity.generate();

    await expect(session.login()).resolves.toBe(true);

    expect(authenticateCalls).toBe(1);
    expect(session.authToken).toBe("test-token");
    expect(api.getAuthToken()).toBe("test-token");
    expect(session.isAuthenticated).toBe(true);
  });

  test("login fails when authentication returns no token", async () => {
    const api = createApi({ authenticate: async () => null });
    const { identity, session } = createSessionHarness({ api });
    await identity.generate();
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
});
