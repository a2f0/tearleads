import { and, eq } from "drizzle-orm";
import {
  organizationProvisioningAttempts,
  organizationProvisioningAttemptTables,
} from "../../sqlite/organizationProvisioningAttemptSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
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
    input: { replacedOrganizationId: string; userId: string },
  ): Promise<void> {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureSqlTables(
        lockedExecSql,
        organizationProvisioningAttemptTables,
      );
      await getClientSQLitePersistenceRuntime(lockedExecSql)
        .db.delete(organizationProvisioningAttempts)
        .where(
          and(
            eq(
              organizationProvisioningAttempts.replacedOrganizationId,
              input.replacedOrganizationId,
            ),
            eq(organizationProvisioningAttempts.userId, input.userId),
          ),
        )
        .run();
    });
  },
};
