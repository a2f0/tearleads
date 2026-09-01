import { and, eq } from "drizzle-orm";
import {
  organizationProvisioningAttempts,
  organizationProvisioningAttemptTables,
} from "../../sqlite/organizationProvisioningAttemptSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";

interface OrganizationProvisioningAttemptRecord {
  readonly replacedOrganizationId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly rootContainerId: string;
  readonly serializedArtifacts: string;
}

export const sqlOrganizationProvisioningAttemptPersistence = {
  async load(
    execSql: ExecSql,
    replacedOrganizationId: string,
  ): Promise<OrganizationProvisioningAttemptRecord | null> {
    await ensureSqlTables(execSql, organizationProvisioningAttemptTables);
    const [stored] = await getClientSQLitePersistenceRuntime(execSql)
      .db.select({
        replacedOrganizationId:
          organizationProvisioningAttempts.replacedOrganizationId,
        userId: organizationProvisioningAttempts.userId,
        organizationId: organizationProvisioningAttempts.organizationId,
        rootContainerId: organizationProvisioningAttempts.rootContainerId,
        serializedArtifacts:
          organizationProvisioningAttempts.serializedArtifacts,
      })
      .from(organizationProvisioningAttempts)
      .where(
        eq(
          organizationProvisioningAttempts.replacedOrganizationId,
          replacedOrganizationId,
        ),
      );
    return stored ?? null;
  },

  async loadOrSave(
    execSql: ExecSql,
    candidate: OrganizationProvisioningAttemptRecord,
    canSave?: (() => boolean) | undefined,
  ): Promise<OrganizationProvisioningAttemptRecord | null> {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureSqlTables(
        lockedExecSql,
        organizationProvisioningAttemptTables,
      );
      if (canSave && !canSave()) return null;
      const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
      await db
        .insert(organizationProvisioningAttempts)
        .values({ ...candidate, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .run();
      const [stored] = await db
        .select({
          replacedOrganizationId:
            organizationProvisioningAttempts.replacedOrganizationId,
          userId: organizationProvisioningAttempts.userId,
          organizationId: organizationProvisioningAttempts.organizationId,
          rootContainerId: organizationProvisioningAttempts.rootContainerId,
          serializedArtifacts:
            organizationProvisioningAttempts.serializedArtifacts,
        })
        .from(organizationProvisioningAttempts)
        .where(
          eq(
            organizationProvisioningAttempts.replacedOrganizationId,
            candidate.replacedOrganizationId,
          ),
        );
      if (!stored) {
        throw new Error("Organization provisioning attempt was not persisted");
      }
      return stored;
    });
  },

  async remove(
    execSql: ExecSql,
    input: {
      organizationId?: string | undefined;
      replacedOrganizationId: string;
      userId: string;
    },
    canCommit?: (() => boolean) | undefined,
  ): Promise<boolean> {
    await ensureSqlTables(execSql, organizationProvisioningAttemptTables);
    if (canCommit && !canCommit()) return false;
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    const remove = async (tx: ClientSQLiteTransactionScope) => {
      await tx
        .delete(organizationProvisioningAttempts)
        .where(
          and(
            eq(
              organizationProvisioningAttempts.replacedOrganizationId,
              input.replacedOrganizationId,
            ),
            eq(organizationProvisioningAttempts.userId, input.userId),
            ...(input.organizationId
              ? [
                  eq(
                    organizationProvisioningAttempts.organizationId,
                    input.organizationId,
                  ),
                ]
              : []),
          ),
        )
        .run();
    };
    if (!canCommit) {
      await runtime.transaction(remove);
      return true;
    }
    return (await runtime.guardedTransaction(remove, canCommit)).committed;
  },
};
