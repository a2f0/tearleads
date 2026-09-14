import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { RemoteContainer } from "./types";

export interface DestinationRole
  extends Pick<
    RemoteContainer,
    "metadataDocumentId" | "parentId" | "systemSlot"
  > {
  /** Signer of the epoch-1 `container.create`; immutable through successors. */
  readonly createSignerUserId: string;
}
/** Roles are verified and cached under the container's id and organization. */
type DestinationIdentity = Pick<RemoteContainer, "id" | "organizationId">;
const rolesByDatabase = new WeakMap<ExecSql, Map<string, DestinationRole>>();
const MAX_ROLES = 1_000;

export function cachedDestinationRole(
  execSql: ExecSql,
  listed: DestinationIdentity,
): DestinationRole | undefined {
  return rolesByDatabase
    .get(execSql)
    ?.get(`${listed.organizationId}:${listed.id}`);
}

export function rememberDestinationRole(
  execSql: ExecSql,
  listed: DestinationIdentity,
  role: DestinationRole,
): void {
  // Shared verification forbids moves of roots and system containers, and all
  // successors preserve the signed slot, metadata id and creator. Cache only
  // these immutable fields; authority, key material and ordinary parent edges
  // remain outside this cache. Reuse does not authorize any read or write
  // operation, so logout and identity switches do not need to invalidate these
  // roles: the session-root creator check runs on every reuse.
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
