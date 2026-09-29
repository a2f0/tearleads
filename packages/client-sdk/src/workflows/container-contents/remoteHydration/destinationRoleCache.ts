import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { RemoteContainer } from "./types";

export interface DestinationRole
  extends Pick<RemoteContainer, "metadataDocumentId" | "systemSlot"> {
  /** Fixed parent only for roots/system slots; ordinary parent edges can move. */
  readonly parentId?: string | null;
  /** Signer of the epoch-1 `container.create`; immutable through successors. */
  readonly createSignerUserId: string;
}
/** Roles are verified and cached under the container's id and organization. */
type DestinationIdentity = Pick<RemoteContainer, "id" | "organizationId">;
interface DestinationRoles {
  fixed: Map<string, DestinationRole>;
  ordinary: Map<string, DestinationRole>;
}
const rolesByDatabase = new WeakMap<ExecSql, DestinationRoles>();
const MAX_ROLES = 1_000;

function destinationKey(identity: DestinationIdentity): string {
  return JSON.stringify([identity.organizationId, identity.id]);
}

export function cachedDestinationRole(
  execSql: ExecSql,
  listed: DestinationIdentity,
): DestinationRole | undefined {
  const roles = rolesByDatabase.get(execSql);
  const key = destinationKey(listed);
  return roles?.fixed.get(key) ?? roles?.ordinary.get(key);
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
  if (
    role.parentId !== undefined &&
    role.parentId !== null &&
    role.systemSlot === null
  ) {
    throw new Error(
      "Ordinary container parents cannot enter the immutable binding cache",
    );
  }
  let cache = rolesByDatabase.get(execSql);
  if (!cache) {
    cache = { fixed: new Map(), ordinary: new Map() };
    rolesByDatabase.set(execSql, cache);
  }
  // Ordinary directory growth must not evict root/system reconciliation roles.
  // Both buckets are bounded independently.
  const roles = role.parentId === undefined ? cache.ordinary : cache.fixed;
  const key = destinationKey(listed);
  if (roles.size >= MAX_ROLES && !roles.has(key)) {
    const oldest = roles.keys().next().value;
    if (oldest !== undefined) roles.delete(oldest);
  }
  roles.set(key, role);
}
