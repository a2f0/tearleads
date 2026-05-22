import { describe, expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { Tearleads, type TearleadsLogger } from "./client";
import type { ExecSql, ExecSqlClientLike } from "./sqlite";

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

describe("Tearleads", () => {
  test("creates grouped SDK namespaces from constructor options", () => {
    const sqlClient = createNoopSqlClient();
    const sdk = new Tearleads({
      apiBaseUrl: "https://api.example.test",
      database: { client: sqlClient, id: "client-db", status: "ready" },
      logger: quietLogger,
      online: false,
    });

    expect(sdk.api).toBeInstanceOf(ApiClient);
    expect(sdk.database.client).toBe(sqlClient);
    expect(sdk.database.execSql).toBeFunction();
    expect(sdk.database.id).toBe("client-db");
    expect(sdk.database.status).toBe("ready");
    expect(sdk.identity.signingFingerprint).toBeNull();
    expect(sdk.network.online).toBe(false);
    expect(sdk.runtime.input).toBeFunction();
    expect(sdk.session.isAuthenticated).toBe(false);
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
    const containerDocuments = sdk.containerDocuments.runtime();
    const contacts = sdk.contacts.runtime();

    expect(documents.containerId).toBe("container-1");
    expect(documents.dbStatus).toBe("ready");
    expect(documents.isAuthenticated).toBe(true);
    expect(documents.online).toBe(true);
    expect(documents.resolveCreateAuthor()).not.toBeNull();
    expect(containerDocuments.userId).toBe("user-1");
    expect(
      containerDocuments.createDocumentsRuntime("container-2").containerId,
    ).toBe("container-2");
    expect(contacts.userId).toBe("user-1");
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
});
