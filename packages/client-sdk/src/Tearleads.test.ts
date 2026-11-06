import { describe, expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import {
  createNoopSqlClient,
  quietLogger,
  setGeneratedIdentity,
} from "../test/helpers/clientTestSupport";
import { Database, Tearleads } from ".";
import { createMemoryBlobStore } from "./data/blobs/memoryBlobStore";
import type { DocumentProjectorDefinition } from "./data/documents";
import { resolveDocumentCreateAuthor } from "./workflows/documents";

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
    expect(sdk.userIdentities.resolveVerified).toBeFunction();
    expect("resolve" in sdk.userIdentities).toBe(false);
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
      isRoot: false,
      rootAcknowledgments: [],
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
