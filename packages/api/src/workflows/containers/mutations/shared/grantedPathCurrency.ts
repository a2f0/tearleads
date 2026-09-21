import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  containers,
} from "@tearleads/api-shared/schema";
import { MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH } from "@tearleads/validators/util";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getCurrentContainerKeyEpochPins } from "../../../../access/read/containerKekStore";
import { ContainerMutationError, descendantRekeysRequired } from "../errors";

const ANCESTRY_CHUNK_SIZE = 500;

interface PathNode {
  readonly depth: number;
  readonly id: string;
  readonly parentId: string | null;
}

/**
 * Whether a rotation that leaves `strandedIds` stale must be refused, and what
 * it must then carry. `closureIds` is every level it owes, parent-first.
 *
 * A closure within `carriedLimit` is owed in full. One that overflows it is
 * owed only as its parent-first prefix: a revocation must never be blockable by
 * the size of a tree, so the remainder repairs lazily. The waiver reads the
 * closure, never the carried count, so padding a batch cannot buy it.
 */
export function requiredCarriedRekeys(input: {
  readonly carriedLimit: number;
  readonly closureIds: readonly string[];
  readonly strandedIds: ReadonlySet<string>;
}): readonly string[] | null {
  const owed = input.closureIds.slice(0, input.carriedLimit);
  return owed.some((containerId) => input.strandedIds.has(containerId))
    ? owed
    : null;
}

async function loadRotatedNodes(
  executor: DatabaseTransaction,
  rotatedContainerIds: readonly string[],
): Promise<PathNode[]> {
  return executor
    .select({
      depth: containers.depth,
      id: containers.id,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(inArray(containers.id, [...rotatedContainerIds]));
}

/** Directly granted containers deep enough to have a level above them to strand. */
async function loadGrantedContainerIds(
  executor: DatabaseTransaction,
  organizationId: string,
  minimumDepth: number,
): Promise<string[]> {
  const rows = await executor
    .selectDistinct({ id: containers.id })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
      ),
    )
    .innerJoin(
      containers,
      eq(containers.id, accessManifestContainerGrantProjection.containerId),
    )
    .where(
      and(
        eq(containers.organizationId, organizationId),
        gte(containers.depth, minimumDepth),
      ),
    );
  return rows.map((row) => row.id);
}

/** Each container's ancestry, walked upward no further than `stopDepth`. */
async function loadAncestry(
  executor: DatabaseTransaction,
  containerIds: readonly string[],
  stopDepth: number,
): Promise<Map<string, PathNode>> {
  const nodes = new Map<string, PathNode>();
  for (
    let start = 0;
    start < containerIds.length;
    start += ANCESTRY_CHUNK_SIZE
  ) {
    const chunk = containerIds.slice(start, start + ANCESTRY_CHUNK_SIZE);
    const result = await executor.execute(sql`
      with recursive ancestry as (
        select ${containers.id} as id, ${containers.parentId} as parent_id,
               ${containers.depth} as depth, 0 as distance
        from ${containers}
        where ${containers.id} in (${sql.join(
          chunk.map((containerId) => sql`${containerId}`),
          sql`, `,
        )})
        union all
        select parent.id, parent.parent_id, parent.depth, ancestry.distance + 1
        from ${containers} parent
        inner join ancestry on parent.id = ancestry.parent_id
        where ancestry.depth > ${stopDepth}
          and ancestry.distance < ${MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH}
      )
      select distinct id, parent_id, depth from ancestry
    `);
    for (const row of result.rows) {
      const id = Reflect.get(row, "id");
      const parentId = Reflect.get(row, "parent_id");
      const depth = Number(Reflect.get(row, "depth"));
      if (
        typeof id !== "string" ||
        (parentId !== null && typeof parentId !== "string") ||
        !Number.isInteger(depth)
      ) {
        throw new ContainerMutationError(
          "Container ancestry row is malformed",
          409,
        );
      }
      nodes.set(id, { depth, id, parentId });
    }
  }
  return nodes;
}

/**
 * Strict descendants of a rotated container that are proper ancestors of a
 * directly granted container, parent-first. These are the levels a writer
 * granted only further down can never re-key itself: a rekey is authorized over
 * the root-to-target path, which a grant below the target is not on.
 *
 * Walks up from the organization's granted containers rather than down the
 * rotated subtree, so the cost follows what is shared, not what is stored.
 */
async function listGrantedPathDescendants(
  executor: DatabaseTransaction,
  organizationId: string,
  rotated: readonly PathNode[],
): Promise<PathNode[]> {
  const rotatedIds = new Set(rotated.map((node) => node.id));
  const shallowest = Math.min(...rotated.map((node) => node.depth));
  // One level must separate the rotated container from the grant.
  const grantedIds = await loadGrantedContainerIds(
    executor,
    organizationId,
    shallowest + 2,
  );
  if (grantedIds.length === 0) return [];
  const nodes = await loadAncestry(executor, grantedIds, shallowest);
  const closure = new Map<string, PathNode>();
  for (const grantedId of grantedIds) {
    const above: PathNode[] = [];
    let node = nodes.get(nodes.get(grantedId)?.parentId ?? "");
    while (node && !rotatedIds.has(node.id) && node.depth > shallowest) {
      above.push(node);
      node = node.parentId === null ? undefined : nodes.get(node.parentId);
    }
    // A chain that ran out above the rotated depth is a tree deeper than the
    // protocol allows: refuse rather than reason about a truncated path.
    if (!node && above.at(-1)?.parentId != null) {
      throw new ContainerMutationError(
        "Container ancestry exceeds the path depth limit",
        409,
      );
    }
    if (node && rotatedIds.has(node.id)) {
      for (const level of above) closure.set(level.id, level);
    }
  }
  return [...closure.values()].sort(
    (left, right) => left.depth - right.depth || (left.id < right.id ? -1 : 1),
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
 * transaction. The refusal names the whole owed set, not just what is stale
 * now: each rekey the client carries stales the level beneath it, so anything
 * less costs a refusal per level, and the refused attempt rolled back anyway.
 */
export async function assertGrantedPathsCurrentBelow(input: {
  readonly carriedLimit: number;
  readonly executor: DatabaseTransaction;
  readonly organizationId: string;
  readonly rotatedContainerIds: readonly string[];
}): Promise<void> {
  if (input.rotatedContainerIds.length === 0) return;
  const rotated = await loadRotatedNodes(
    input.executor,
    input.rotatedContainerIds,
  );
  if (rotated.length === 0) return;
  const closure = await listGrantedPathDescendants(
    input.executor,
    input.organizationId,
    rotated,
  );
  if (closure.length === 0) return;
  const pins = await getCurrentContainerKeyEpochPins(
    [
      ...closure.map((node) => node.id),
      ...closure.flatMap((node) => (node.parentId ? [node.parentId] : [])),
    ],
    input.executor,
  );
  const strandedIds = new Set<string>();
  for (const node of closure) {
    const pin = pins.get(node.id);
    // An unkeyed container wraps nothing to its parent.
    if (!pin || node.parentId === null) continue;
    if (
      pin.parentContainerKeyEpochId !== (pins.get(node.parentId)?.id ?? null)
    ) {
      strandedIds.add(node.id);
    }
  }
  const required = requiredCarriedRekeys({
    carriedLimit: input.carriedLimit,
    closureIds: closure.map((node) => node.id),
    strandedIds,
  });
  if (required) throw descendantRekeysRequired(required);
}
