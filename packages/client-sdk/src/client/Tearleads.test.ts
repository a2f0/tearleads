import { describe, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { loadContainers } from "../data/persistence/containers/containerPersistence";
import type { DocumentProjectorDefinition } from "../documents";
import type {
  ExecSql,
  ExecSqlClientLike,
  SqlArrayRow,
  SqlBind,
  SqlRow,
  SqlRowMode,
} from "../sqlite";
import {
  defaultDocumentsPersistence,
  resolveDocumentCreateAuthor,
} from "../workflows/documents";
import { Database, type SessionSnapshot, Tearleads } from ".";

const EMPTY_IDENTITY_SNAPSHOT = {
  encapsulationKeyPair: null,
  seedPhrase: null,
  signingFingerprint: null,
  signingKeyPair: null,
} as const;

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
      database: { client: sqlClient, id: "client-db" },
      logger: quietLogger,
      online: false,
    });

    expect(sdk.database.client).toBe(sqlClient);
    expect(sdk.database.execSql).toBeFunction();
    expect(sdk.database.id).toBe("client-db");
    expect(sdk.database.status).toBe("ready");
    expect(sdk.identity.signingFingerprint).toBeNull();
    expect(sdk.network.online).toBe(false);
    expect(sdk.organizations.deleteGroup).toBeFunction();
    expect(sdk.organizations.loadDirectoryAndGroups).toBeFunction();
    expect(sdk.runtime.input).toBeFunction();
    expect("apiClient" in sdk.runtime.input()).toBe(false);
    expect("workflowInput" in sdk.runtime).toBe(false);
    expect(sdk.session.isAuthenticated).toBe(false);
    expect(sdk.userIdentities.resolve).toBeFunction();
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

  test("local-only mode folds into the resolved runtime state.online", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    expect(sdk.runtime.input().state.online).toBe(true);

    sdk.session.setSyncEnabled(false);
    // Sync paths see offline...
    expect(sdk.runtime.input().state.online).toBe(false);
    // ...but connectivity stays truthful for host/UI.
    expect(sdk.network.online).toBe(true);

    sdk.session.setSyncEnabled(true);
    expect(sdk.runtime.input().state.online).toBe(true);
  });

  test("local-only mode keeps state.online false while offline", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: false });
    sdk.session.setSyncEnabled(false);
    expect(sdk.runtime.input().state.online).toBe(false);

    // Regaining connectivity must not resume sync while local-only.
    sdk.network.setOnline(true);
    expect(sdk.runtime.input().state.online).toBe(false);
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
    });
    sdk.database.configure({
      client: sqlClient,
      id: "client-db",
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

  test("manual network mode overrides detected connectivity changes", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    sdk.network.setMode("offline");
    sdk.network.setOnline(true);
    sdk.network.setMode("online");
    sdk.network.setOnline(false);
    sdk.network.setMode("automatic");

    expect(snapshots).toEqual([false, true, false]);
    expect(sdk.network.detectedOnline).toBe(false);
    expect(sdk.network.mode).toBe("automatic");
    expect(sdk.network.online).toBe(false);
  });

  test("notifies network subscribers when mode changes without changing effective online state", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    sdk.network.setMode("online");

    expect(snapshots).toEqual([true]);
    expect(sdk.network.mode).toBe("online");
    expect(sdk.network.online).toBe(true);
  });

  test("notifies event subscribers with stable snapshots", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const snapshots: ReadonlyArray<unknown>[] = [];
    expect(sdk.runtime.input().state.serverEventsConnectionGeneration).toBe(0);
    const unsubscribe = sdk.events.subscribe(() => {
      snapshots.push(sdk.events.snapshot.events);
    });

    sdk.events.push({ type: "document.updated" });
    sdk.events.setConnected(true);
    sdk.events.setConnected(true);
    sdk.events.setConnected(false);
    sdk.events.setConnected(true);
    unsubscribe();
    sdk.events.push({ type: "ignored" });

    expect(snapshots).toEqual([
      [{ type: "document.updated" }],
      [{ type: "document.updated" }],
      [{ type: "document.updated" }],
      [{ type: "document.updated" }],
    ]);
    expect(sdk.events.connected).toBe(true);
    expect(sdk.events.connectionGeneration).toBe(2);
    expect(sdk.runtime.input().state.serverEventsConnectionGeneration).toBe(2);
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

  test("rejects identity generation until SQLite is ready", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const ephemeralStore = sdk.blobs.store;

    await expect(sdk.identity.generate()).rejects.toThrow("ready SQLite");

    expect(sdk.identity.snapshot).toEqual(EMPTY_IDENTITY_SNAPSHOT);
    expect(sdk.session.containerId).toBeNull();
    expect(sdk.blobs.store).toBe(ephemeralStore);
  });

  test("generates identity keys, bootstraps the local root container, and switches blob storage when SQLite is ready", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-identity-generate-root-bootstrap-test",
    );
    try {
      const sdk = new Tearleads({
        blobStoreFactory: () => createMemoryBlobStore(),
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });
      const ephemeralStore = sdk.blobs.store;

      const result = await sdk.identity.generate();

      expect(result.rootContainerCreated).toBe(true);
      expect(result.rootContainerId).toHaveLength(36);
      expect(result.userId).toBeNull();
      expect(sdk.session.containerId).toBe(result.rootContainerId);
      expect(result.signingKeyPair).not.toBeNull();
      expect(result.encapsulationKeyPair).not.toBeNull();
      expect(result.signingFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(sdk.identity.signingFingerprint).toBe(result.signingFingerprint);
      expect(sdk.blobs.store).not.toBe(ephemeralStore);

      await expect(sdk.session.bootstrapLocalRootContainer()).resolves.toEqual({
        containerId: result.rootContainerId,
        created: false,
      });

      const containers = await loadContainers(execSql);
      expect(containers).toEqual([
        expect.objectContaining({
          id: result.rootContainerId,
          name: "/",
          parentId: null,
        }),
      ]);

      sdk.identity.destroy();

      expect(sdk.identity.signingFingerprint).toBeNull();
      expect(sdk.blobs.store).toBe(ephemeralStore);
    } finally {
      close();
    }
  });

  test("rejects identity generation when automatic root bootstrap fails", async () => {
    const messages: string[] = [];
    const execSql: ExecSql = async () => {
      throw new Error("locked database");
    };
    const sdk = new Tearleads({
      database: { execSql, id: "client-db" },
      logger: {
        ...quietLogger,
        log: (message) => messages.push(message),
      },
    });

    await expect(sdk.identity.generate()).rejects.toThrow("locked database");

    expect(sdk.identity.snapshot).toEqual(EMPTY_IDENTITY_SNAPSHOT);
    expect(sdk.session.containerId).toBeNull();
    expect(messages.join()).toContain("locked database");
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

    const snapshot = await setGeneratedIdentity(sdk.identity);
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
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
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

    await setGeneratedIdentity(sdk.identity);
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
    const source = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(source.identity);

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
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
    const keyPackage = await sdk.identity.exportKeyPackage();

    await expect(
      sdk.identity.importKeyPackage({
        ...keyPackage,
        signingFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow("signing fingerprint does not match");
  });

  test("rejects identity key packages with mismatched signing key pairs", async () => {
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
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
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
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
      blobStoreFactory: () => createMemoryBlobStore(),
      database: { client: sqlClient, id: "client-db" },
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
    sdk.session.setContext({
      containerId: "container-1",
      isAuthenticated: true,
      organizationId: "organization-1",
      userId: "user-1",
    });

    const documents = sdk.documents.workflowRuntime();
    const containerContents = sdk.containerContents.workflowRuntime();
    const unsubscribeDocuments = sdk.documents.subscribe(() => undefined, {
      containerId: "container-1",
    });

    expect(documents.state.containerId).toBe("container-1");
    expect(documents.infra.dbStatus).toBe("ready");
    expect(documents.auth.isAuthenticated).toBe(true);
    expect(documents.state.online).toBe(true);
    expect(resolveDocumentCreateAuthor(documents)).not.toBeNull();
    expect(sdk.documents.open().getSnapshot).toBeFunction();
    expect(
      sdk.documents.open({ localId: "sdk-runtime-note" }).getSnapshot,
    ).toBeFunction();
    expect(unsubscribeDocuments).toBeFunction();
    unsubscribeDocuments();
    expect(containerContents.auth.userId).toBe("user-1");
    expect(containerContents.adoptRootContainer).toBeFunction();
    const documentLinks = sdk.containerContents.documentLinks();
    expect(documentLinks.documentRuntime("container-2").state.containerId).toBe(
      "container-2",
    );
    expect(documentLinks.resolveProjectionUserKey).toBeFunction();
    expect(documentLinks.canMutateDocumentLinks).toBe(true);
    expect(documentLinks.canMutateUnsyncedDocumentLinks).toBe(true);
    expect(documentLinks.openDocument).toBeFunction();
    expect(documentLinks.moveDocumentToContainer).toBeFunction();
    expect(documentLinks.linkDocumentToContainer).toBeFunction();
    expect(documentLinks.unlinkDocumentFromContainer).toBeFunction();
    expect(documentLinks.setActiveDocumentContainer).toBeFunction();
  });

  test("lists documents through the documents service", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-test",
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
          snapshotEndVersion: "",
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
          snapshotEndVersion: "",
          text: "",
          title: "Contact title",
        },
        { updatedAt: "2026-05-24T11:00:00.000Z" },
      );
      const sdk = new Tearleads({
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });

      expect(await sdk.documents.list({ documentKind: "note" })).toEqual({
        rows: [
          {
            accessStateHash: null,
            containerId: "container-1",
            documentId: null,
            documentKind: "note",
            effectiveAccessLevel: "read",
            id: "note-1",
            title: "Note title",
            updatedAt: "2026-05-24T12:00:00.000Z",
          },
        ],
        totalCount: 1,
      });
      await expect(sdk.documents.delete("note-1")).resolves.toBe(true);
      expect(await sdk.documents.list({ documentKind: "note" })).toEqual({
        rows: [],
        totalCount: 0,
      });
    } finally {
      close();
    }
  });

  test("lists documents with pagination and sorting", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-window-test",
    );
    try {
      await defaultDocumentsPersistence.ensureSchema(execSql);
      async function saveNote(
        id: string,
        title: string,
        updatedAt: string,
      ): Promise<void> {
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
            id,
            lastCommitLsn: null,
            snapshotEndVersion: "",
            text: title,
            title,
          },
          { updatedAt },
        );
      }

      await saveNote("note-z", "Zebra", "2026-05-24T12:00:00.000Z");
      await saveNote("note-a", "Alpha", "2026-05-24T11:00:00.000Z");
      await saveNote("note-m", "Middle", "2026-05-24T10:00:00.000Z");
      const sdk = new Tearleads({
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });

      expect(
        await sdk.documents.list({
          documentKind: "note",
          limit: 2,
          offset: 1,
          sort: { direction: "asc", key: "title" },
        }),
      ).toEqual({
        rows: [
          {
            accessStateHash: null,
            containerId: "container-1",
            documentId: null,
            documentKind: "note",
            effectiveAccessLevel: "read",
            id: "note-m",
            title: "Middle",
            updatedAt: "2026-05-24T10:00:00.000Z",
          },
          {
            accessStateHash: null,
            containerId: "container-1",
            documentId: null,
            documentKind: "note",
            effectiveAccessLevel: "read",
            id: "note-z",
            title: "Zebra",
            updatedAt: "2026-05-24T12:00:00.000Z",
          },
        ],
        totalCount: 3,
      });
    } finally {
      close();
    }
  });

  test("caches documents service schema initialization per SQL executor", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-schema-cache-test",
    );
    try {
      let createStatementCount = 0;
      const observedExecSql = createObservedExecSql(execSql, (sql) => {
        if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
          createStatementCount += 1;
        }
      });
      const sdk = new Tearleads({
        database: {
          execSql: observedExecSql,
          id: "client-db",
        },
        logger: quietLogger,
      });
      expect(await sdk.documents.list()).toEqual({
        rows: [],
        totalCount: 0,
      });
      const firstCreateCount = createStatementCount;
      expect(firstCreateCount).toBeGreaterThan(0);
      expect(await sdk.documents.list()).toEqual({
        rows: [],
        totalCount: 0,
      });
      expect(createStatementCount).toBe(firstCreateCount);
    } finally {
      close();
    }
  });

  test("creates the container contents document queries from the SDK runtime", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-container-contents-queries-test",
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
          snapshotEndVersion: "",
          text: "Note text",
          title: "Note title",
        },
        { updatedAt: "2026-05-24T12:00:00.000Z" },
      );
      const sdk = new Tearleads({
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });
      const readModel = sdk.containerContents.documentQueries();

      expect(await readModel.loadDocumentSummary("note-1")).toEqual({
        accessStateHash: "access-state-hash",
        containerId: "container-1",
        documentId: "document-1",
        documentKind: "note",
        effectiveAccessLevel: "read",
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
    const sessionSnapshots: SessionSnapshot[] = [];
    const runtimeVersions: number[] = [];
    const unsubscribeSession = sdk.session.subscribe(() => {
      sessionSnapshots.push(sdk.session.snapshot);
    });
    const unsubscribeRuntime = sdk.runtime.subscribe(() => {
      runtimeVersions.push(sdk.runtime.version);
    });

    sdk.session.setContext({
      containerId: "container-1",
      defaultOrganizationId: "organization-1",
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
        defaultOrganizationId: "organization-1",
        isAuthenticated: false,
        organizationId: "organization-1",
        userId: "user-1",
      },
      {
        authToken: "session-token",
        containerId: "container-1",
        defaultOrganizationId: "organization-1",
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
        new Database({
          status: "ready",
        }),
    ).toThrow("ready SQLite database requires a configured executor");
  });

  test("rotates workflow domain scope when storage or identity changes", async () => {
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    const initialScope = sdk.domainScope;

    sdk.database.configure({
      client: createNoopSqlClient(),
      id: "client-db",
    });
    const databaseScope = sdk.domainScope;

    expect(databaseScope).not.toBe(initialScope);
    expect(sdk.runtime.input().state.domainScope).toBe(databaseScope);

    await setGeneratedIdentity(sdk.identity);
    const identityScope = sdk.domainScope;

    expect(identityScope).not.toBe(databaseScope);
    expect(sdk.runtime.input().state.domainScope).toBe(identityScope);
  });

  test("session registration skips unavailable prerequisites", async () => {
    const messages: string[] = [];
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
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

    await setGeneratedIdentity(sdk.identity);
    await expect(sdk.session.registerIdentity()).resolves.toBeNull();

    expect(messages).toEqual([
      "Registration skipped: container id is unavailable",
      "Registration skipped: signing key is unavailable",
      "Registration skipped: encapsulation key is unavailable",
      "Registration skipped: database client is unavailable",
    ]);
  });
});
