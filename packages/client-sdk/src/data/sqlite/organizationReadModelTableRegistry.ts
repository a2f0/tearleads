import {
  organizationReadModelContainerGrants,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
  organizationReadModelPolicyHeads,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "./organizationReadModelSchema";
import { defineSqlTableSchema, type SqlTableSchema } from "./sqlTableSchema";

export const organizationReadModelTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(organizationReadModelState),
  defineSqlTableSchema(organizationReadModelRequesters),
  defineSqlTableSchema(organizationReadModelDirectoryUsers),
  defineSqlTableSchema(organizationReadModelGroups),
  defineSqlTableSchema(organizationReadModelPolicyHeads),
  defineSqlTableSchema(organizationReadModelGroupMemberships),
  defineSqlTableSchema(organizationReadModelGroupMembers),
  defineSqlTableSchema(organizationReadModelContainerGrants),
];

export const organizationReadModelSQLiteSchema = {
  organizationReadModelState,
  organizationReadModelRequesters,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroups,
  organizationReadModelPolicyHeads,
  organizationReadModelGroupMemberships,
  organizationReadModelGroupMembers,
  organizationReadModelContainerGrants,
};
