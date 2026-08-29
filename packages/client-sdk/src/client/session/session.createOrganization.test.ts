import { expect, test } from "bun:test";
import type { ApiClient } from "@symcrypt/api-client";
import { createTestExecSql } from "@symcrypt/test-utils";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createSqlClient,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { clientSqlTables, containers } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import type { ExecSql } from "../../sqlite";
import { Database } from "../database";
import { createIdentity } from "../identity";
import { createSession } from "./index";

function createHarness(input: {
  execSql: ExecSql;
  databaseId: string;
  onCreateOrganization?: () => Promise<void>;
  onExec?: () => void;
  onOrganizationRequest?: (
    request: Parameters<ApiClient["createOrganization"]>[0],
  ) => void;
  organizationBillingStatus?: "deleting" | "purged";
}) {
  const api = {
    createOrganization: async (
      request: Parameters<ApiClient["createOrganization"]>[0],
    ) => {
      input.onOrganizationRequest?.(request);
      const response = await respondToOrganizationProvisioning(request);
      await input.onCreateOrganization?.();
      return response;
    },
    clearWriterProjectionCaches: () => undefined,
    getOrganizationBilling: async (organizationId: string) => ({
      organizationId,
      status: input.organizationBillingStatus ?? "purged",
    }),
    getAuthToken: () => null,
    setAuthToken: () => undefined,
  } as unknown as ApiClient;
  const identity = createIdentity(
    {},
    () => undefined,
    () => undefined,
  );
  const session = createSession({
    api,
    database: new Database({
      client: createSqlClient(input.execSql, input.onExec),
      id: input.databaseId,
    }),
    identity,
    log: () => undefined,
    logError: () => undefined,
    onUserIdentityAvailable: async () => undefined,
  });
  return { identity, session };
}

test("createOrganization returns the provisioned organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-create-organization-test",
  );
  const { identity, session } = createHarness({
    databaseId: "create-organization-test-db",
    execSql,
  });

  try {
    await setGeneratedIdentity(identity);
    session.setContext({ userId: crypto.randomUUID() });

    const result = await session.createOrganization();
    expect(result).toEqual({
      containerId: expect.any(String),
      organizationId: expect.any(String),
    });
  } finally {
    close();
  }
});

test("createOrganization discards the result after the identity changes", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-create-organization-race-test",
  );
  let switched = false;
  let switchIdentity = async () => undefined;
  let persistenceWritesAfterSwitch = 0;
  const { identity, session } = createHarness({
    databaseId: "create-organization-race-test-db",
    execSql,
    onCreateOrganization: () => switchIdentity(),
    onExec: () => {
      if (switched) {
        persistenceWritesAfterSwitch += 1;
      }
    },
  });

  try {
    await setGeneratedIdentity(identity);
    session.setContext({ userId: crypto.randomUUID() });
    // The identity is replaced while the provisioning request is in flight.
    // The organization was created under keys that no longer describe the
    // active identity, so the caller must not receive it — and the workflow
    // must not run local persistence, whose captured database client an
    // identity switch closes or renews. Mirrors the registerIdentity
    // transition test.
    switchIdentity = async () => {
      await setGeneratedIdentity(identity);
      switched = true;
    };

    await expect(session.createOrganization()).resolves.toBeNull();
    expect(persistenceWritesAfterSwitch).toBe(0);
  } finally {
    close();
  }
});

test("recoverPurgedOrganization waits for purge and rebinds local data to a fresh organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-recover-purged-organization-test",
  );
  const oldOrganizationId = crypto.randomUUID();
  let requestedReplacement: string | undefined;
  const { identity, session } = createHarness({
    databaseId: "recover-purged-organization-test-db",
    execSql,
    onOrganizationRequest: (request) => {
      requestedReplacement = request.replacesOrganizationId;
    },
    organizationBillingStatus: "purged",
  });
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await getClientSQLitePersistenceRuntime(execSql)
      .db.insert(containers)
      .values({
        id: "retained-old-root",
        organizationId: oldOrganizationId,
        parentId: null,
        metadataDocumentId: "old-metadata",
        systemSlot: "root",
        localCreatedAt: "2026-08-01T00:00:00.000Z",
        localUpdatedAt: "2026-08-01T00:00:00.000Z",
      });
    await setGeneratedIdentity(identity);
    session.setContext({
      defaultOrganizationId: oldOrganizationId,
      organizationId: oldOrganizationId,
      userId: crypto.randomUUID(),
    });

    const recovered =
      await session.recoverPurgedOrganization(oldOrganizationId);
    invariant(recovered, "expected recovered organization");
    expect(requestedReplacement).toBe(oldOrganizationId);
    expect(recovered.organizationId).not.toBe(oldOrganizationId);
    expect(recovered.replacedOrganizationId).toBe(oldOrganizationId);
    expect(session.defaultOrganizationId).toBe(recovered.organizationId);
    expect(session.organizationId).toBe(recovered.organizationId);
    expect(session.containerId).toBe(recovered.containerId);
    const [oldRoot] = await getClientSQLitePersistenceRuntime(execSql)
      .db.select()
      .from(containers)
      .where(eq(containers.id, "retained-old-root"));
    expect(oldRoot).toEqual(
      expect.objectContaining({
        organizationId: recovered.organizationId,
        parentId: recovered.containerId,
        systemSlot: null,
      }),
    );
  } finally {
    close();
  }
});

test("recoverPurgedOrganization rejects recovery while deletion is still running", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-recover-deleting-organization-test",
  );
  const { identity, session } = createHarness({
    databaseId: "recover-deleting-organization-test-db",
    execSql,
    organizationBillingStatus: "deleting",
  });
  try {
    await setGeneratedIdentity(identity);
    session.setContext({ userId: crypto.randomUUID() });
    await expect(
      session.recoverPurgedOrganization(crypto.randomUUID()),
    ).rejects.toThrow("cannot be recovered before its purge finishes");
  } finally {
    close();
  }
});
