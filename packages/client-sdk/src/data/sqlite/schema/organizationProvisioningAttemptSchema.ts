import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Durable client-side provisioning handoff, keyed by the replacement source,
 * native-restore scope, or (for ordinary creates) the generated organization id.
 *
 * The replacement request is intentionally retained until both remote
 * provisioning and the organization-scoped local reset commit. A lost HTTP
 * response or a failed local reset can therefore replay the exact signed
 * artifacts instead of minting an incompatible second organization. Ordinary
 * creates retain a user-and-input-scoped intent only until the local bootstrap
 * commits, allowing a subsequent deliberate create with identical inputs.
 * Greenfield storage: prechange attempts are not migrated.
 */
export const organizationProvisioningAttempts = sqliteTable(
  "organization_provisioning_attempts",
  {
    replacedOrganizationId: text("replaced_organization_id").primaryKey(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    rootContainerId: text("root_container_id").notNull(),
    identityBundleFormat: integer("identity_bundle_format")
      .notNull()
      .default(1),
    serializedArtifacts: text("serialized_artifacts").notNull(),
    creationIntent: text("creation_intent"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("organization_provisioning_creation_intent_idx").on(
      table.userId,
      table.creationIntent,
    ),
  ],
);

export const organizationProvisioningAttemptTables: ReadonlyArray<SqlTableSchema> =
  [
    {
      ...defineSqlTableSchema(organizationProvisioningAttempts),
      requiredColumns: ["creation_intent", "identity_bundle_format"],
    },
  ];

export const organizationProvisioningAttemptSQLiteSchema = {
  organizationProvisioningAttempts,
};
