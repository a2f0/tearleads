import { describe, expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "../test/helpers/createTestExecSql";
import { createResponseFromRequest } from "../test/helpers/documentFixtures";
import { Tearleads, type TearleadsLogger } from "./client";
import type {
  ExecSql,
  ExecSqlClientLike,
  SqlArrayRow,
  SqlBind,
  SqlRow,
  SqlRowMode,
} from "./sqlite";
import {
  defaultDocumentsPersistence,
  resolveDocumentCreateAuthor,
} from "./workflows/documents";

const quietLogger: Required<TearleadsLogger> = {
  log: () => undefined,
  logError: () => undefined,
};

function createNoopSqlClient(): ExecSqlClientLike {
  return {
    async exec() {
      return { rows: [] };
    },
  };
}

function createSqlClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

function createObservedExecSql(
  execSql: ExecSql,
  observe: (sql: string) => void,
): ExecSql {
  async function observedExecSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>> {
    observe(sql);
    return execSql(sql, bind, options);
  }

  return observedExecSql as ExecSql;
}

describe("Tearleads", () => {
  test("creates grouped SDK namespaces from constructor options", () => {
    const sqlClient = createNoopSqlClient();
    const sdk = new Tearleads({
      apiBaseUrl: "https://api.example.test",
      database: { client: sqlClient, id: "client-db", status: "ready" },
      logger: quietLogger,
      online: false,
    });

    expect(sdk.database.client).toBe(sqlClient);
    expect(sdk.database.execSql).toBeFunction();
    expect(sdk.database.id).toBe("client-db");
    expect(sdk.database.status).toBe("ready");
    expect(sdk.identity.signingFingerprint).toBeNull();
    expect(sdk.network.online).toBe(false);
    expect(sdk.organizations.loadDirectoryAndGroups).toBeFunction();
    expect(sdk.runtime.input).toBeFunction();
    expect("apiClient" in sdk.runtime.input()).toBe(false);
    expect("workflowInput" in sdk.runtime).toBe(false);
    expect(sdk.session.isAuthenticated).toBe(false);
    expect(sdk.userKeys.fetch).toBeFunction();
  });

  test("notifies database subscribers with stable snapshots", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const sqlClient = createNoopSqlClient();
    const snapshots: Array<{
      id: string | null;
      status: string;
    }> = [];
    const unsubscribe = sdk.database.subscribe(() => {
      snapshots.push({
        id: sdk.database.snapshot.id,
        status: sdk.database.snapshot.status,
      });
    });

    sdk.database.configure({
      client: sqlClient,
      id: "client-db",
      status: "ready",
    });
    sdk.database.configure({
      client: sqlClient,
      id: "client-db",
      status: "ready",
    });
    sdk.database.clear("terminated");
    unsubscribe();
    sdk.database.clear();

    expect(snapshots).toEqual([
      { id: "client-db", status: "ready" },
      { id: null, status: "terminated" },
    ]);
  });

  test("notifies network subscribers when online state changes", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    const unsubscribe = sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    sdk.network.setOnline(false);
    sdk.network.setOnline(false);
    sdk.network.setOnline(true);
    unsubscribe();
    sdk.network.setOnline(false);

    expect(snapshots).toEqual([false, true]);
    expect(sdk.network.online).toBe(false);
  });

  test("continues notifying network subscribers after listener failure", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    sdk.network.subscribe(() => {
      throw new Error("listener failed");
    });
    sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    expect(() => sdk.network.setOnline(false)).not.toThrow();

    expect(snapshots).toEqual([false]);
    expect(sdk.network.online).toBe(false);
  });

  test("notifies event subscribers with stable snapshots", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const snapshots: ReadonlyArray<unknown>[] = [];
    const unsubscribe = sdk.events.subscribe(() => {
      snapshots.push(sdk.events.snapshot.events);
    });

    sdk.events.push({ type: "document.updated" });
    sdk.events.setConnected(true);
    sdk.events.setConnected(true);
    unsubscribe();
    sdk.events.push({ type: "ignored" });

    expect(snapshots).toEqual([
      [{ type: "document.updated" }],
      [{ type: "document.updated" }],
    ]);
    expect(sdk.events.connected).toBe(true);
  });

  test("continues notifying event subscribers after listener failure", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    let notifications = 0;
    sdk.events.subscribe(() => {
      throw new Error("listener failed");
    });
    sdk.events.subscribe(() => {
      notifications += 1;
    });

    expect(() => sdk.events.push({ type: "document.updated" })).not.toThrow();

    expect(notifications).toBe(1);
  });

  test("generates identity keys and switches blob storage to the identity namespace", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const ephemeralStore = sdk.blobs.store;

    const snapshot = await sdk.identity.generate();

    expect(snapshot.signingKeyPair).not.toBeNull();
    expect(snapshot.encapsulationKeyPair).not.toBeNull();
    expect(snapshot.signingFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(sdk.identity.signingFingerprint).toBe(snapshot.signingFingerprint);
    expect(sdk.blobs.store).not.toBe(ephemeralStore);

    sdk.identity.destroy();

    expect(sdk.identity.signingFingerprint).toBeNull();
    expect(sdk.blobs.store).toBe(ephemeralStore);
  });

  test("notifies identity subscribers with stable snapshots", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const snapshots: Array<{
      hasEncapsulationKeyPair: boolean;
      hasSigningKeyPair: boolean;
      signingFingerprint: string | null;
    }> = [];
    const unsubscribe = sdk.identity.subscribe(() => {
      snapshots.push({
        hasEncapsulationKeyPair:
          sdk.identity.snapshot.encapsulationKeyPair !== null,
        hasSigningKeyPair: sdk.identity.snapshot.signingKeyPair !== null,
        signingFingerprint: sdk.identity.snapshot.signingFingerprint,
      });
    });

    await sdk.identity.generate();
    sdk.identity.destroy();
    unsubscribe();
    sdk.identity.destroy();

    expect(snapshots).toEqual([
      {
        hasEncapsulationKeyPair: true,
        hasSigningKeyPair: true,
        signingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      {
        hasEncapsulationKeyPair: false,
        hasSigningKeyPair: false,
        signingFingerprint: null,
      },
    ]);
  });

  test("exports and imports identity key packages", async () => {
    const source = new Tearleads({ logger: quietLogger });
    await source.identity.generate();

    const keyPackage = await source.identity.exportKeyPackage();
    source.identity.destroy();
    await source.identity.importKeyPackage(
      JSON.parse(JSON.stringify(keyPackage)),
    );

    expect(source.identity.signingFingerprint).toBe(
      keyPackage.signingFingerprint,
    );
    expect(
      Array.from(source.identity.signingKeyPair?.signingPublicKey ?? []),
    ).toEqual(
      Array.from(base64ToBytes(keyPackage.signingKeyPair.signingPublicKey)),
    );
  });

  test("rejects identity key packages with mismatched signing fingerprints", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    await sdk.identity.generate();
    const keyPackage = await sdk.identity.exportKeyPackage();

    await expect(
      sdk.identity.importKeyPackage({
        ...keyPackage,
        signingFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow("signing fingerprint does not match");
  });

  test("rejects identity key packages with mismatched signing key pairs", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    await sdk.identity.generate();
    const keyPackage = await sdk.identity.exportKeyPackage();
    const otherSigningKeyPair = generateSigningSeedAndKeyPair();

    await expect(
      sdk.identity.importKeyPackage({
        ...keyPackage,
        signingKeyPair: {
          ...keyPackage.signingKeyPair,
          signingPrivateKey: bytesToBase64(
            otherSigningKeyPair.signingPrivateKey,
          ),
        },
      }),
    ).rejects.toThrow("signing private key does not match");
  });

  test("rejects identity key packages with mismatched encapsulation key pairs", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    await sdk.identity.generate();
    const keyPackage = await sdk.identity.exportKeyPackage();
    const otherEncapsulationKeyPair = generateKemSeedAndKeyPair();

    await expect(
      sdk.identity.importKeyPackage({
        ...keyPackage,
        encapsulationKeyPair: {
          ...keyPackage.encapsulationKeyPair,
          secretKey: bytesToBase64(otherEncapsulationKeyPair.secretKey),
        },
      }),
    ).rejects.toThrow("encapsulation secret key does not match");
  });

  test("creates workflow runtimes from the current SDK state", async () => {
    const sqlClient = createNoopSqlClient();
    const sdk = new Tearleads({
      database: { client: sqlClient, id: "client-db", status: "ready" },
      logger: quietLogger,
    });
    await sdk.identity.generate();
    sdk.session.setContext({
      containerId: "container-1",
      isAuthenticated: true,
      organizationId: "organization-1",
      userId: "user-1",
    });

    const documents = sdk.documents.runtime();
    const containerContents = sdk.containerContents.runtime();

    expect(documents.containerId).toBe("container-1");
    expect(documents.dbStatus).toBe("ready");
    expect(documents.isAuthenticated).toBe(true);
    expect(documents.online).toBe(true);
    expect(resolveDocumentCreateAuthor(documents)).not.toBeNull();
    expect(containerContents.userId).toBe("user-1");
    const documentLinksRuntime = sdk.containerContents.documentLinksRuntime();
    expect(
      documentLinksRuntime.createDocumentRuntime("container-2").containerId,
    ).toBe("container-2");
    expect(documentLinksRuntime.resolveProjectionUserKey).toBeFunction();
    expect(documentLinksRuntime.canMutateDocumentLinks).toBe(true);
  });

  test("lists local document summaries through the documents service", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-summaries-test",
    );
    try {
      await defaultDocumentsPersistence.ensureSchema(execSql);
      await defaultDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: null,
          containerId: "container-1",
          contentKeyBundle: null,
          documentId: null,
          documentKekTargets: null,
          documentKind: "note",
          documentManifestBundle: null,
          id: "note-1",
          lastCommitLsn: null,
          loroSnapshot: "",
          text: "Note text",
          title: "Note title",
        },
        { updatedAt: "2026-05-24T12:00:00.000Z" },
      );
      await defaultDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: null,
          containerId: "container-1",
          contentKeyBundle: null,
          documentId: null,
          documentKekTargets: null,
          documentKind: "contact",
          documentManifestBundle: null,
          id: "contact-1",
          lastCommitLsn: null,
          loroSnapshot: "",
          text: "",
          title: "Contact title",
        },
        { updatedAt: "2026-05-24T11:00:00.000Z" },
      );
      const sdk = new Tearleads({
        database: { execSql, id: "client-db", status: "ready" },
        logger: quietLogger,
      });

      expect(
        await sdk.documents.listLocalSummaries({ documentKind: "note" }),
      ).toEqual([
        {
          accessStateHash: null,
          containerId: "container-1",
          documentId: null,
          documentKind: "note",
          id: "note-1",
          title: "Note title",
          updatedAt: "2026-05-24T12:00:00.000Z",
        },
      ]);
    } finally {
      close();
    }
  });

  test("caches documents service schema initialization per SQL executor", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-summaries-schema-cache-test",
    );
    try {
      let createTableStatementCount = 0;
      const observedExecSql = createObservedExecSql(execSql, (sql) => {
        if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
          createTableStatementCount += 1;
        }
      });
      const sdk = new Tearleads({
        database: {
          execSql: observedExecSql,
          id: "client-db",
          status: "ready",
        },
        logger: quietLogger,
      });

      expect(await sdk.documents.listLocalSummaries()).toEqual([]);
      const firstCallCreateTableStatementCount = createTableStatementCount;
      expect(firstCallCreateTableStatementCount).toBeGreaterThan(0);

      expect(await sdk.documents.listLocalSummaries()).toEqual([]);
      expect(createTableStatementCount).toBe(
        firstCallCreateTableStatementCount,
      );
    } finally {
      close();
    }
  });

  test("creates the container contents document read model from the SDK runtime", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-container-contents-read-model-test",
    );
    try {
      await defaultDocumentsPersistence.ensureSchema(execSql);
      await defaultDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: "access-state-hash",
          containerId: "container-1",
          contentKeyBundle: null,
          documentId: "document-1",
          documentKekTargets: null,
          documentKind: "note",
          documentManifestBundle: null,
          id: "note-1",
          lastCommitLsn: null,
          loroSnapshot: "",
          text: "Note text",
          title: "Note title",
        },
        { updatedAt: "2026-05-24T12:00:00.000Z" },
      );
      const sdk = new Tearleads({
        database: { execSql, id: "client-db", status: "ready" },
        logger: quietLogger,
      });
      const readModel = sdk.containerContents.documentReadModel();

      expect(await readModel.loadDocumentSummary("note-1")).toEqual({
        accessStateHash: "access-state-hash",
        containerId: "container-1",
        documentId: "document-1",
        documentKind: "note",
        id: "note-1",
        title: "Note title",
        updatedAt: "2026-05-24T12:00:00.000Z",
      });
    } finally {
      close();
    }
  });

  test("notifies session and runtime subscribers from SDK state changes", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const sessionSnapshots: Array<{
      authToken: string | null;
      containerId: string | null;
      isAuthenticated: boolean;
      organizationId: string | null;
      userId: string | null;
    }> = [];
    const runtimeVersions: number[] = [];
    const unsubscribeSession = sdk.session.subscribe(() => {
      sessionSnapshots.push(sdk.session.snapshot);
    });
    const unsubscribeRuntime = sdk.runtime.subscribe(() => {
      runtimeVersions.push(sdk.runtime.version);
    });

    sdk.session.setContext({
      containerId: "container-1",
      organizationId: "organization-1",
      userId: "user-1",
    });
    sdk.session.setContext({
      containerId: "container-1",
      organizationId: "organization-1",
      userId: "user-1",
    });
    sdk.session.setContext({
      authToken: "session-token",
      isAuthenticated: true,
    });
    sdk.network.setOnline(false);
    unsubscribeSession();
    unsubscribeRuntime();
    sdk.session.logout();

    expect(sdk.runtime.input().containerId).toBe("container-1");
    expect(sessionSnapshots).toEqual([
      {
        authToken: null,
        containerId: "container-1",
        isAuthenticated: false,
        organizationId: "organization-1",
        userId: "user-1",
      },
      {
        authToken: "session-token",
        containerId: "container-1",
        isAuthenticated: true,
        organizationId: "organization-1",
        userId: "user-1",
      },
    ]);
    expect(runtimeVersions).toEqual([1, 2, 3]);
  });

  test("creates workflow runtime input before a database is available", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const input = sdk.runtime.input();

    expect(input.dbStatus).toBe("idle");
    await expect(input.execSql("select 1")).rejects.toThrow(
      "Database client is unavailable.",
    );
  });

  test("rejects ready database state without a SQLite executor", () => {
    expect(
      () =>
        new Tearleads({
          database: { status: "ready" },
          logger: quietLogger,
        }),
    ).toThrow("ready SQLite database requires a configured executor");
  });

  test("workflow runtime callbacks use the captured SQLite executor", async () => {
    const messages: string[] = [];
    const execSql: ExecSql = async () => {
      throw new Error("captured executor");
    };
    const sdk = new Tearleads({
      database: { execSql, status: "ready" },
      logger: {
        ...quietLogger,
        log: (message) => messages.push(message),
      },
    });
    const input = sdk.runtime.input();

    sdk.database.clear("terminated");

    await input.cacheReferencedPrincipalPolicies([
      {
        keyEpoch: 1,
        keyFingerprint: "key-fingerprint",
        principalId: "group-1",
        principalType: "group",
        stateHash: "state-hash",
        version: 1,
      },
    ]);

    expect(messages).toContain(
      "Principal policy cache: failed to initialize cache: captured executor",
    );
  });

  test("rotates workflow domain scope when storage or identity changes", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const initialScope = sdk.domainScope;

    sdk.database.configure({
      client: createNoopSqlClient(),
      id: "client-db",
      status: "ready",
    });
    const databaseScope = sdk.domainScope;

    expect(databaseScope).not.toBe(initialScope);
    expect(sdk.runtime.input().domainScope).toBe(databaseScope);

    await sdk.identity.generate();
    const identityScope = sdk.domainScope;

    expect(identityScope).not.toBe(databaseScope);
    expect(sdk.runtime.input().domainScope).toBe(identityScope);
  });

  test("session registers the current identity through the internal api client", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-session-register-identity-test",
    );
    const apiClient = new ApiClient("");
    const containerId = crypto.randomUUID();
    let registerUserCalls = 0;
    apiClient.registerUser = async (
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
    };
    const sdk = new Tearleads({
      apiClient,
      database: {
        client: createSqlClient(execSql),
        id: "registration-test-db",
        status: "ready",
      },
      logger: quietLogger,
    });

    try {
      await sdk.identity.generate();
      sdk.session.setContainerId(containerId);

      const result = await sdk.session.registerIdentity();
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
      expect(sdk.session.containerId).toBe(containerId);
      expect(sdk.session.organizationId).toBe(result.organizationId);
      expect(sdk.session.userId).toBe(result.userId);
    } finally {
      close();
    }
  });

  test("session registration skips unavailable prerequisites", async () => {
    const messages: string[] = [];
    const sdk = new Tearleads({
      logger: {
        ...quietLogger,
        log: (message) => messages.push(message),
      },
    });

    await expect(sdk.session.registerIdentity()).resolves.toBeNull();

    sdk.session.setContainerId("container-1");
    await expect(sdk.session.registerIdentity()).resolves.toBeNull();

    await sdk.identity.setKeyPairs({
      encapsulationKeyPair: null,
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    await expect(sdk.session.registerIdentity()).resolves.toBeNull();

    await sdk.identity.generate();
    await expect(sdk.session.registerIdentity()).resolves.toBeNull();

    expect(messages).toEqual([
      "Registration skipped: container id is unavailable",
      "Registration skipped: signing key is unavailable",
      "Registration skipped: encapsulation key is unavailable",
      "Key pair generated",
      "Registration skipped: database client is unavailable",
    ]);
  });

  test("session registration logs workflow failures before propagating them", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-session-register-identity-failure-test",
    );
    const registrationError = new Error("remote registration unavailable");
    const errors: Array<{ cause: unknown; message: string | Error }> = [];
    const apiClient = new ApiClient("");
    apiClient.registerUser = async () => {
      throw registrationError;
    };
    const sdk = new Tearleads({
      apiClient,
      database: {
        client: createSqlClient(execSql),
        id: "registration-failure-test-db",
        status: "ready",
      },
      logger: {
        ...quietLogger,
        logError: (message, cause) => errors.push({ cause, message }),
      },
    });

    try {
      await sdk.identity.generate();
      sdk.session.setContainerId(crypto.randomUUID());

      await expect(sdk.session.registerIdentity()).rejects.toThrow(
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
    const apiClient = new ApiClient("");
    let authenticateCalls = 0;
    apiClient.authenticate = async () => {
      authenticateCalls += 1;
      return "test-token";
    };
    const sdk = new Tearleads({ apiClient, logger: quietLogger });
    await sdk.identity.generate();

    await expect(sdk.session.login()).resolves.toBe(true);

    expect(authenticateCalls).toBe(1);
    expect(sdk.session.authToken).toBe("test-token");
    expect(apiClient.getAuthToken()).toBe("test-token");
    expect(sdk.session.isAuthenticated).toBe(true);
  });

  test("login fails when authentication returns no token", async () => {
    const apiClient = new ApiClient("");
    apiClient.authenticate = async () => null;
    const sdk = new Tearleads({ apiClient, logger: quietLogger });
    await sdk.identity.generate();
    sdk.session.setAuthToken("stale-token");

    await expect(sdk.session.login()).resolves.toBe(false);

    expect(sdk.session.authToken).toBeNull();
    expect(apiClient.getAuthToken()).toBeNull();
    expect(sdk.session.isAuthenticated).toBe(false);
  });

  test("session lists active sessions through the internal api client", async () => {
    const apiClient = new ApiClient("");
    let listSessionsCalls = 0;
    apiClient.listSessions = async () => {
      listSessionsCalls += 1;
      return {
        sessions: [
          {
            createdAt: "2026-05-22T10:00:00.000Z",
            id: "a".repeat(64),
            isCurrent: true,
            signingKeyFingerprint: "b".repeat(64),
          },
        ],
      };
    };
    const sdk = new Tearleads({ apiClient, logger: quietLogger });

    await expect(sdk.session.listSessions()).resolves.toEqual([
      {
        createdAt: "2026-05-22T10:00:00.000Z",
        id: "a".repeat(64),
        isCurrent: true,
        signingKeyFingerprint: "b".repeat(64),
      },
    ]);

    expect(listSessionsCalls).toBe(1);
  });

  test("session destroys active sessions through the internal api client", async () => {
    const apiClient = new ApiClient("");
    const destroyedSessionIds: string[] = [];
    apiClient.destroySession = async (sessionId) => {
      destroyedSessionIds.push(sessionId);
      return { message: "ok" };
    };
    const sdk = new Tearleads({ apiClient, logger: quietLogger });
    const sessionId = "c".repeat(64);

    await expect(sdk.session.destroySession(sessionId)).resolves.toBe(true);

    expect(destroyedSessionIds).toEqual([sessionId]);
  });

  test("remote logout clears the local authenticated session", async () => {
    const apiClient = new ApiClient("");
    let logoutCalls = 0;
    apiClient.logout = async () => {
      logoutCalls += 1;
      return { message: "ok" };
    };
    const sdk = new Tearleads({ apiClient, logger: quietLogger });
    sdk.session.setAuthToken("test-token");
    sdk.session.setContext({ isAuthenticated: true });

    await expect(sdk.session.logoutRemote()).resolves.toBe(true);

    expect(logoutCalls).toBe(1);
    expect(sdk.session.authToken).toBeNull();
    expect(apiClient.getAuthToken()).toBeNull();
    expect(sdk.session.isAuthenticated).toBe(false);
  });

  test("remote logout clears the local session when the remote request fails", async () => {
    const apiClient = new ApiClient("");
    let logoutCalls = 0;
    apiClient.logout = async () => {
      logoutCalls += 1;
      return null;
    };
    const sdk = new Tearleads({ apiClient, logger: quietLogger });
    sdk.session.setAuthToken("stale-token");
    sdk.session.setContext({ isAuthenticated: true });

    await expect(sdk.session.logoutRemote()).resolves.toBe(false);

    expect(logoutCalls).toBe(1);
    expect(sdk.session.authToken).toBeNull();
    expect(apiClient.getAuthToken()).toBeNull();
    expect(sdk.session.isAuthenticated).toBe(false);
  });
});
