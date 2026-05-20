import { describe, expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import type { ExecSqlClientLike } from "./data/sqlite/sqlSchema";
import { Tearleads, type TearleadsLogger } from "./Tearleads";

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
    expect(sdk.db.client).toBe(sqlClient);
    expect(sdk.db.execSql).toBeFunction();
    expect(sdk.db.id).toBe("client-db");
    expect(sdk.db.status).toBe("ready");
    expect(sdk.identity.signingFingerprint).toBeNull();
    expect(sdk.network.online).toBe(false);
    expect(sdk.session.isAuthenticated).toBe(false);
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

    const documents = sdk.workflows.documents();
    const explorer = sdk.workflows.explorer();
    const contacts = sdk.workflows.contacts();

    expect(documents.containerId).toBe("container-1");
    expect(documents.dbStatus).toBe("ready");
    expect(documents.isAuthenticated).toBe(true);
    expect(documents.online).toBe(true);
    expect(documents.resolveCreateAuthor()).not.toBeNull();
    expect(explorer.userId).toBe("user-1");
    expect(explorer.createDocumentsRuntime("container-2").containerId).toBe(
      "container-2",
    );
    expect(contacts.userId).toBe("user-1");
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
});
