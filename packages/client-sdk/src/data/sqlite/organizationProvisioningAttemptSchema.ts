import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "./sqlTableSchema";

/**
 * Durable client-side handoff for a purged personal organization replacement.
 *
 * The replacement request is intentionally retained until both remote
 * provisioning and the organization-scoped local reset commit. A lost HTTP
 * response or a failed local reset can therefore replay the exact signed
 * artifacts instead of minting an incompatible second organization.
 */
export const organizationProvisioningAttempts = sqliteTable(
  "organization_provisioning_attempts",
  {
    replacedOrganizationId: text("replaced_organization_id").primaryKey(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    rootContainerId: text("root_container_id").notNull(),
    serializedArtifacts: text("serialized_artifacts").notNull(),
    createdAt: text("created_at").notNull(),
  },
);

export const organizationProvisioningAttemptTables: ReadonlyArray<SqlTableSchema> =
  [defineSqlTableSchema(organizationProvisioningAttempts)];

export const organizationProvisioningAttemptSQLiteSchema = {
  organizationProvisioningAttempts,
};
