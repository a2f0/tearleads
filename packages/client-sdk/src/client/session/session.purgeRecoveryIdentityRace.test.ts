import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
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

class IdentitySwitchingDatabase extends Database {
  private switched = false;

  constructor(
    client: ExecSqlClientLike,
    private readonly resetExecSql: ExecSql,
    private readonly switchAccount: () => void,
  ) {
    super({ client });
  }

  override requireExecSql(operation?: string): ExecSql {
    if (operation !== "recoverPurgedOrganization") {
      return super.requireExecSql(operation);
    }
    return (async (sql, bind, options) => {
      const rows = await this.resetExecSql(sql, bind, options);
      if (
        !this.switched &&
        sql.includes('delete from "organization_data_usage_categories"')
      ) {
        this.switched = true;
        this.switchAccount();
      }
      return rows;
    }) as ExecSql;
  }
}

test("an identity switch during recovery rolls back reset and preserves the new session", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-purge-recovery-identity-race-test",
  );
  const oldOrganizationId = crypto.randomUUID();
  const oldUserId = crypto.randomUUID();
  const newOrganizationId = crypto.randomUUID();
  const newUserId = crypto.randomUUID();
  let cacheClearCount = 0;
  const api = {
    createOrganization: async (request: CreateOrganizationRequest) =>
      respondToOrganizationProvisioning(request),
    clearWriterProjectionCaches: () => {
      cacheClearCount += 1;
    },
    getOrganizationBilling: async (organizationId: string) => {
      const active = organizationId !== oldOrganizationId;
      return {
        activeMemberCount: 1,
        assignedSeatCount: active ? 1 : 0,
        assignedUserIds: active ? [oldUserId] : [],
        currentPeriodEndsAt: active ? "2099-01-01T00:00:00.000Z" : null,
        currentPeriodStartsAt: active ? "2026-08-29T00:00:00.000Z" : null,
        currentUserHasSyncSeat: active,
        disabledAt: null,
        organizationId,
        pendingSeatCount: null,
        provider: null,
        purgeAfter: null,
        seatCount: active ? 1 : 0,
        status: active ? ("active" as const) : ("purged" as const),
        trialEndsAt: null,
      };
    },
    getAuthToken: () => null,
    setAuthToken: () => undefined,
  } as unknown as ApiClient;
  const identity = createIdentity(
    {},
    () => undefined,
    () => undefined,
  );
  let switchAccount = () => undefined;
  const session = createSession({
    api,
    database: new IdentitySwitchingDatabase(
      createSqlClient(execSql),
      execSql,
      () => switchAccount(),
    ),
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
        id: "identity-race-root",
        organizationId: oldOrganizationId,
        parentId: null,
        metadataDocumentId: "identity-race-metadata",
        systemSlot: "root",
        localCreatedAt: "2026-08-01T00:00:00.000Z",
        localUpdatedAt: "2026-08-01T00:00:00.000Z",
      });
    await setGeneratedIdentity(identity);
    session.setContext({
      defaultOrganizationId: oldOrganizationId,
      organizationId: oldOrganizationId,
      userId: oldUserId,
    });
    switchAccount = () => {
      identity.destroy();
      session.setContext({
        defaultOrganizationId: newOrganizationId,
        organizationId: newOrganizationId,
        userId: newUserId,
      });
    };

    await expect(
      session.recoverPurgedOrganization(oldOrganizationId),
    ).rejects.toThrow("session identity changed");
    expect(session.userId).toBe(newUserId);
    expect(session.organizationId).toBe(newOrganizationId);
    expect(session.defaultOrganizationId).toBe(newOrganizationId);
    expect(cacheClearCount).toBe(0);
    const [oldRoot] = await getClientSQLitePersistenceRuntime(execSql)
      .db.select()
      .from(containers)
      .where(eq(containers.id, "identity-race-root"));
    expect(oldRoot).toEqual(
      expect.objectContaining({
        organizationId: oldOrganizationId,
        parentId: null,
        systemSlot: "root",
      }),
    );
    expect(
      await getClientSQLitePersistenceRuntime(execSql)
        .db.select()
        .from(organizationProvisioningAttempts),
    ).toHaveLength(1);
  } finally {
    close();
  }
});
