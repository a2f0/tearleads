import { expect, test } from "bun:test";
import type { ApiClient } from "@symcrypt/api-client";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { CreateOrganizationRequest } from "@symcrypt/validators/request";
import type { CreateOrganizationResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createSqlClient,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { organizationProvisioningAttempts } from "../../data/sqlite/organizationProvisioningAttemptSchema";
import { clientSqlTables, containers } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { Database } from "../database";
import { createIdentity } from "../identity";
import { createSession } from "./index";

class ResetFailingDatabase extends Database {
  private failNextReset = true;

  constructor(
    client: ExecSqlClientLike,
    private readonly resetExecSql: ExecSql,
  ) {
    super({ client });
  }

  override requireExecSql(operation?: string): ExecSql {
    if (operation !== "recoverPurgedOrganization") {
      return super.requireExecSql(operation);
    }
    return (async (sql, bind, options) => {
      if (this.failNextReset) {
        this.failNextReset = false;
        throw new Error("local reset interrupted");
      }
      return this.resetExecSql(sql, bind, options);
    }) as ExecSql;
  }
}

test("recovery reuses its durable replacement after a local reset failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-purge-recovery-reset-retry-test",
  );
  const oldOrganizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const requests: CreateOrganizationRequest[] = [];
  let serverResponse: CreateOrganizationResponse | null = null;
  const api = {
    createOrganization: async (request: CreateOrganizationRequest) => {
      requests.push(request);
      serverResponse ??= await respondToOrganizationProvisioning(request);
      return serverResponse;
    },
    clearWriterProjectionCaches: () => undefined,
    getOrganizationBilling: async (organizationId: string) => ({
      organizationId,
      status: "purged" as const,
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
    database: new ResetFailingDatabase(createSqlClient(execSql), execSql),
    identity,
    log: () => undefined,
    logError: () => undefined,
    onUserIdentityAvailable: async () => undefined,
  });

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await getClientSQLitePersistenceRuntime(execSql)
      .db.insert(containers)
      .values({
        id: "retry-retained-root",
        organizationId: oldOrganizationId,
        parentId: null,
        metadataDocumentId: "retry-old-metadata",
        systemSlot: "root",
        localCreatedAt: "2026-08-01T00:00:00.000Z",
        localUpdatedAt: "2026-08-01T00:00:00.000Z",
      });
    await setGeneratedIdentity(identity);
    session.setContext({
      defaultOrganizationId: oldOrganizationId,
      organizationId: oldOrganizationId,
      userId,
    });

    await expect(
      session.recoverPurgedOrganization(oldOrganizationId),
    ).rejects.toThrow("local reset interrupted");
    expect(requests).toHaveLength(1);
    expect(
      await getClientSQLitePersistenceRuntime(execSql)
        .db.select()
        .from(organizationProvisioningAttempts),
    ).toHaveLength(1);

    const recovered =
      await session.recoverPurgedOrganization(oldOrganizationId);
    invariant(recovered, "expected recovered organization");
    expect(requests).toHaveLength(2);
    const firstRequest = requests[0];
    invariant(firstRequest, "expected first replacement request");
    expect(requests[1]).toEqual(firstRequest);
    expect(recovered.organizationId).toBe(firstRequest.organizationId);
    expect(
      await getClientSQLitePersistenceRuntime(execSql)
        .db.select()
        .from(organizationProvisioningAttempts),
    ).toEqual([]);
    const [oldRoot] = await getClientSQLitePersistenceRuntime(execSql)
      .db.select()
      .from(containers)
      .where(eq(containers.id, "retry-retained-root"));
    expect(oldRoot?.organizationId).toBe(recovered.organizationId);
    expect(oldRoot?.parentId).toBe(recovered.containerId);
  } finally {
    close();
  }
});
