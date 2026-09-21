import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  containers,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getCurrentContainerKeyEpoch } from "../../../../access/read/containerKekStore";
import { uuidValue } from "../../../../utils/sqlDialect";
import { descendantRekeysRequired } from "../errors";

const MAX_SUBTREE_DEPTH = 100;
const GRANT_LOOKUP_CHUNK_SIZE = 1000;

interface SubtreeRow {
  readonly depth: number;
  readonly id: string;
  readonly parentId: string;
}

async function loadStrictDescendants(
  executor: DatabaseTransaction,
  containerId: string,
): Promise<SubtreeRow[]> {
  const result = await executor.execute(sql`
    with recursive subtree as (
      select child.id as id, child.parent_id as parent_id,
             child.depth as depth, 1 as distance
      from ${containers} child
      where child.parent_id = ${uuidValue(containerId)}
      union all
      select child.id, child.parent_id, child.depth, subtree.distance + 1
      from ${containers} child
      inner join subtree on child.parent_id = subtree.id
      where subtree.distance < ${MAX_SUBTREE_DEPTH}
    )
    select id, parent_id, depth from subtree
  `);
  const rows: SubtreeRow[] = [];
  for (const row of result.rows) {
    const id = Reflect.get(row, "id");
    const parentId = Reflect.get(row, "parent_id");
    const depth = Number(Reflect.get(row, "depth"));
    if (
      typeof id !== "string" ||
      typeof parentId !== "string" ||
      !Number.isInteger(depth)
    ) {
      throw new Error("Container subtree row is malformed");
    }
    rows.push({ depth, id, parentId });
  }
  return rows;
}

async function loadDirectlyGrantedIds(
  executor: DatabaseTransaction,
  containerIds: readonly string[],
): Promise<Set<string>> {
  const granted = new Set<string>();
  for (
    let start = 0;
    start < containerIds.length;
    start += GRANT_LOOKUP_CHUNK_SIZE
  ) {
    const rows = await executor
      .selectDistinct({ containerId: accessManifestHeads.objectId })
      .from(accessManifestHeads)
      .innerJoin(
        accessManifestContainerGrantProjection,
        and(
          eq(
            accessManifestContainerGrantProjection.manifestHash,
            accessManifestHeads.manifestHash,
          ),
          eq(
            accessManifestContainerGrantProjection.containerId,
            accessManifestHeads.objectId,
          ),
        ),
      )
      .where(
        and(
          eq(accessManifestHeads.objectKind, "container"),
          inArray(
            accessManifestHeads.objectId,
            containerIds.slice(start, start + GRANT_LOOKUP_CHUNK_SIZE),
          ),
        ),
      );
    for (const row of rows) granted.add(row.containerId);
  }
  return granted;
}

/**
 * Strict descendants of `containerId` that are proper ancestors of a directly
 * granted container, parent-first. These are the levels a writer granted only
 * further down can never re-key itself: a rekey is authorized over the
 * root-to-target path, which a grant below the target is not on.
 */
async function listGrantedPathDescendants(
  executor: DatabaseTransaction,
  containerId: string,
): Promise<SubtreeRow[]> {
  const subtree = await loadStrictDescendants(executor, containerId);
  if (subtree.length === 0) return [];
  const rowsById = new Map(subtree.map((row) => [row.id, row]));
  const granted = await loadDirectlyGrantedIds(executor, [...rowsById.keys()]);
  const onGrantedPath = new Set<string>();
  for (const grantedId of granted) {
    for (
      let ancestor = rowsById.get(rowsById.get(grantedId)?.parentId ?? "");
      ancestor && !onGrantedPath.has(ancestor.id);
      ancestor = rowsById.get(ancestor.parentId)
    ) {
      onGrantedPath.add(ancestor.id);
    }
  }
  return subtree
    .filter((row) => onGrantedPath.has(row.id))
    .sort(
      (left, right) =>
        left.depth - right.depth || (left.id < right.id ? -1 : 1),
    );
}

/**
 * No-brick for writes (#2340): a committed rotation never leaves a level above
 * a directly granted container pinned to a retired parent epoch. The grantee
 * re-keys from its own container downward, so with these levels current its
 * writes never wait on another device's. The rotator can always comply:
 * access and keys inherit downward from the container it just rotated.
 *
 * Call after the rotation and everything it carried are persisted, in the same
 * transaction. A batch already at its cap waives the remainder rather than
 * refuse: a revocation must never be blockable by the size of a tree.
 */
export async function assertGrantedPathsCurrentBelow(input: {
  readonly capReached: boolean;
  readonly executor: DatabaseTransaction;
  readonly rotatedContainerIds: readonly string[];
}): Promise<void> {
  if (input.capReached || input.rotatedContainerIds.length === 0) return;
  const currentEpochIdByContainerId = new Map<string, string | null>();
  const currentEpochId = async (containerId: string) => {
    if (!currentEpochIdByContainerId.has(containerId)) {
      const keyEpoch = await getCurrentContainerKeyEpoch(
        containerId,
        input.executor,
      );
      currentEpochIdByContainerId.set(containerId, keyEpoch?.id ?? null);
    }
    return currentEpochIdByContainerId.get(containerId) ?? null;
  };
  // Parent-first across every rotated container: `depth` is absolute.
  const closure = new Map<string, SubtreeRow>();
  for (const rotatedId of new Set(input.rotatedContainerIds)) {
    for (const row of await listGrantedPathDescendants(
      input.executor,
      rotatedId,
    )) {
      closure.set(row.id, row);
    }
  }
  const rows = [...closure.values()].sort(
    (left, right) => left.depth - right.depth || (left.id < right.id ? -1 : 1),
  );
  let stranded = false;
  for (const row of rows) {
    const keyEpoch = await getCurrentContainerKeyEpoch(row.id, input.executor);
    // An unkeyed container wraps nothing to its parent.
    if (!keyEpoch) continue;
    if (
      keyEpoch.parentContainerKeyEpochId !==
      (await currentEpochId(row.parentId))
    ) {
      stranded = true;
      break;
    }
  }
  // Name the whole closure, not just what is stale now: each rekey the client
  // carries stales the level beneath it, so anything less costs a refusal per
  // level. The refused attempt rolled back, so every level is still owed.
  if (stranded) throw descendantRekeysRequired(rows.map((row) => row.id));
}
