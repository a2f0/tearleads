import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";
import {
  organizationPresentationDenials,
  organizationReadModelContainerGrants,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "./organizationReadModelSchema";

export const organizationReadModelTables: ReadonlyArray<SqlTableSchema> = [
  // Lane heads folded into these rows (#2522); an older local shape must reset.
  {
    ...defineSqlTableSchema(organizationReadModelState),
    requiredColumns: ["member_group_state_hash", "organization_state_hash"],
  },
  defineSqlTableSchema(organizationReadModelRequesters),
  {
    ...defineSqlTableSchema(organizationReadModelDirectoryUsers),
    requiredColumns: ["is_personal_organization_owner"],
  },
  {
    ...defineSqlTableSchema(organizationReadModelGroups),
    requiredColumns: ["key_fingerprint", "members_state_hash"],
  },
  defineSqlTableSchema(organizationReadModelGroupMembers),
  defineSqlTableSchema(organizationReadModelContainerGrants),
  defineSqlTableSchema(organizationPresentationDenials),
];

export const organizationReadModelSQLiteSchema = {
  organizationReadModelState,
  organizationReadModelRequesters,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroups,
  organizationReadModelGroupMembers,
  organizationReadModelContainerGrants,
  organizationPresentationDenials,
};
