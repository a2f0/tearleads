import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { RemoteContainer } from "./types";

type DestinationRole = Pick<
  RemoteContainer,
  "metadataDocumentId" | "parentId" | "systemSlot"
>;
const rolesByDatabase = new WeakMap<ExecSql, Map<string, DestinationRole>>();
const MAX_ROLES = 1_000;

export function cachedDestinationRole(
  execSql: ExecSql,
  listed: RemoteContainer,
): DestinationRole | undefined {
  return rolesByDatabase
    .get(execSql)
    ?.get(`${listed.organizationId}:${listed.id}`);
}

export function rememberDestinationRole(
  execSql: ExecSql,
  listed: RemoteContainer,
  role: DestinationRole,
): void {
  // Shared verification forbids moves of roots and system containers, and all
  // successors preserve the signed slot and metadata id. Cache only these
  // immutable fields; authority, key material and ordinary parent edges remain
  // outside this cache. Reuse does not authorize any read or write operation.
  if (role.parentId !== null && role.systemSlot === null) return;
  let roles = rolesByDatabase.get(execSql);
  if (!roles) {
    roles = new Map();
    rolesByDatabase.set(execSql, roles);
  }
  if (roles.size >= MAX_ROLES) {
    const oldest = roles.keys().next().value;
    if (oldest !== undefined) roles.delete(oldest);
  }
  roles.set(`${listed.organizationId}:${listed.id}`, role);
}
