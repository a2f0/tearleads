import { describe, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { type Logger, Tearleads } from "./client";
import { createMemoryBlobStore } from "./data/blobs/memoryBlobStore";
import type { DocumentProjectorDefinition } from "./documents";
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

const quietLogger: Required<Logger> = {
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

  test("uses apiBaseUrl for internal api requests", async () => {
    const previousFetch = globalThis.fetch;
    const requests: Array<{ input: string; method: string | undefined }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ input: String(input), method: init?.method });
      return new Response(JSON.stringify({ sessions: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      const sdk = new Tearleads({
        apiBaseUrl: " https://api.example.test/ ",
        logger: quietLogger,
      });

      await expect(sdk.session.listSessions()).resolves.toEqual([]);
      expect(requests).toEqual([
        {
          input: "https://api.example.test/auth/sessions",
          method: "GET",
        },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("exposes grouped runtime input", () => {
    const sqlClient = createNoopSqlClient();
    const sdk = new Tearleads({
      database: { client: sqlClient, id: "client-db", status: "ready" },
      logger: quietLogger,
      online: false,
    });
    sdk.session.setContext({
      containerId: "container-1",
      isAuthenticated: true,
      organizationId: "organization-1",
      userId: "user-1",
    });

    const input = sdk.runtime.input();

    expect(input.auth).toEqual({
      isAuthenticated: true,
      organizationId: "organization-1",
      userId: "user-1",
    });
    expect("apiClient" in input).toBe(false);
    expect("userId" in input).toBe(false);
    expect("execSql" in input).toBe(false);
    expect("containerId" in input).toBe(false);
  });

  test("keeps unrelated runtime input groups referentially stable", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const initial = sdk.runtime.input();

    sdk.session.setContext({
      organizationId: "organization-1",
      userId: "user-1",
    });
    const afterAuthChange = sdk.runtime.input();

    expect(afterAuthChange.auth).not.toBe(initial.auth);
    expect(afterAuthChange.crypto).toBe(initial.crypto);
    expect(afterAuthChange.infra).toBe(initial.infra);
    expect(afterAuthChange.state).toBe(initial.state);
    expect(afterAuthChange.util).toBe(initial.util);

    sdk.events.push({ type: "document.updated" });
    const afterStateChange = sdk.runtime.input();

    expect(afterStateChange.auth).toBe(afterAuthChange.auth);
    expect(afterStateChange.crypto).toBe(afterAuthChange.crypto);
    expect(afterStateChange.infra).toBe(afterAuthChange.infra);
    expect(afterStateChange.state).not.toBe(afterAuthChange.state);
    expect(afterStateChange.util).toBe(afterAuthChange.util);
  });

  test("accepts document projector definitions in constructor options", () => {
    const definitions: ReadonlyArray<DocumentProjectorDefinition> = [
      {
        kind: "claim",
        label: "claim",
      },
    ];
    const sdk = new Tearleads({
      documentProjectors: definitions,
      logger: quietLogger,
    });

    expect(
      sdk.runtime
        .input()
        .infra.documentProjectors.getStoredDocumentTypeLabel("claim"),
    ).toBe("claim");
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

  test("uses a blob store factory for identity namespaces", async () => {
    const namespaces: string[] = [];
    const stores = [createMemoryBlobStore()];
    const sdk = new Tearleads({
      blobStoreFactory: (namespace) => {
        namespaces.push(namespace);
        const store = stores[namespaces.length - 1];
        if (!store) {
          throw new Error("Unexpected blob store factory call.");
        }

        return store;
      },
      logger: quietLogger,
    });
    const ephemeralStore = sdk.blobs.store;

    const snapshot = await sdk.identity.generate();
    if (!snapshot.signingFingerprint) {
      throw new Error("Expected generated signing fingerprint.");
    }
    const identityStore = stores[0];
    if (!identityStore) {
      throw new Error("Expected identity blob store.");
    }

    expect(namespaces).toEqual([snapshot.signingFingerprint]);
    expect(sdk.blobs.store).toBe(identityStore);
    expect(sdk.blobs.store).not.toBe(ephemeralStore);

    sdk.identity.destroy();

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
    const unsubscribeDocuments = sdk.documents.subscribeToLocalSummaries(
      () => undefined,
      { containerId: "container-1" },
    );

    expect(documents.state.containerId).toBe("container-1");
    expect(documents.infra.dbStatus).toBe("ready");
    expect(documents.auth.isAuthenticated).toBe(true);
    expect(documents.state.online).toBe(true);
    expect(resolveDocumentCreateAuthor(documents)).not.toBeNull();
    expect(sdk.documents.store().getSnapshot).toBeFunction();
    expect(
      sdk.documents.primeStore({ localId: "sdk-runtime-note" }).getSnapshot,
    ).toBeFunction();
    expect(unsubscribeDocuments).toBeFunction();
    unsubscribeDocuments();
    expect(containerContents.auth.userId).toBe("user-1");
    const documentLinksRuntime = sdk.containerContents.documentLinksRuntime();
    expect(
      documentLinksRuntime.createDocumentRuntime("container-2").state
        .containerId,
    ).toBe("container-2");
    expect(documentLinksRuntime.resolveProjectionUserKey).toBeFunction();
    expect(documentLinksRuntime.canMutateDocumentLinks).toBe(true);
    expect(documentLinksRuntime.canMutateLocalDocumentLinks).toBe(true);
    expect(documentLinksRuntime.primeDocumentStore).toBeFunction();
    expect(documentLinksRuntime.moveDocumentToContainer).toBeFunction();
    expect(documentLinksRuntime.linkDocumentToContainer).toBeFunction();
    expect(documentLinksRuntime.unlinkDocumentFromContainer).toBeFunction();
    expect(documentLinksRuntime.activateDocumentContainer).toBeFunction();
    expect(
      sdk.containerContents.hasUndiscoveredDocumentUpdates(new Set()),
    ).toBe(false);
  });

  test("container document discovery ignores known container metadata document updates", () => {
    const sdk = new Tearleads({
      events: [
        {
          documentId: "metadata-document-1",
          type: "document_update_created",
        },
        {
          documentId: "user-document-1",
          type: "document_update_created",
        },
      ],
    });
    const snapshot = sdk.containerContents.store().getSnapshot() as unknown as {
      nodes: Array<{ metadataDocumentId: string }>;
    };
    snapshot.nodes = [{ metadataDocumentId: "metadata-document-1" }];

    expect(
      sdk.containerContents.hasUndiscoveredDocumentUpdates(
        new Set(["user-document-1"]),
      ),
    ).toBe(false);
    expect(
      sdk.containerContents.hasUndiscoveredDocumentUpdates(new Set()),
    ).toBe(true);
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
      await expect(sdk.documents.deleteLocalDocument("note-1")).resolves.toBe(
        true,
      );
      expect(
        await sdk.documents.listLocalSummaries({ documentKind: "note" }),
      ).toEqual([]);
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

    expect(sdk.runtime.input().state.containerId).toBe("container-1");
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

    expect(input.infra.dbStatus).toBe("idle");
    await expect(input.infra.execSql("select 1")).rejects.toThrow(
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

    await input.util.cacheReferencedPrincipalPolicies([
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
    expect(sdk.runtime.input().state.domainScope).toBe(databaseScope);

    await sdk.identity.generate();
    const identityScope = sdk.domainScope;

    expect(identityScope).not.toBe(databaseScope);
    expect(sdk.runtime.input().state.domainScope).toBe(identityScope);
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
});
