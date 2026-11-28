import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { uniqueSortedStrings } from "../../utils/array";
import {
  textExpression,
  visitedPathAppend,
  visitedPathContains,
  visitedPathStart,
} from "../../utils/postgresSql";

const ancestorEdgeRowSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
});

/**
 * Extracts `[root, ..., containerId]` paths from verified manifest paths
 * already in memory.
 */
export function containerPathsFromVerifiedPaths(
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): Record<string, readonly string[]> {
  const result: Record<string, readonly string[]> = {};
  for (const path of paths) {
    const leaf = path.at(-1);
    if (!leaf) continue;
    result[leaf.state.containerId] = path.map(
      (manifest) => manifest.state.containerId,
    );
  }
  return result;
}

function buildPathFromParents(
  containerId: string,
  parentById: ReadonlyMap<string, string | null>,
): readonly string[] | null {
  const reversed: string[] = [];
  const visited = new Set<string>();
  let current: string | null = containerId;
  while (current !== null) {
    if (visited.has(current) || reversed.length >= MAX_CONTAINER_PATH_LENGTH) {
      return null;
    }
    visited.add(current);
    reversed.push(current);
    if (!parentById.has(current)) return null;
    current = parentById.get(current) ?? null;
  }
  return reversed.reverse();
}

/**
 * Completes `[root, ..., containerId]` routing paths for any linked containers
 * not already present in `knownPaths`, walking `containers.parent_id` upward
 * in one recursive CTE. Executes zero SQL when every id is already known.
 */
export async function resolveMissingContainerAncestorPaths(input: {
  readonly containerIds: readonly string[];
  readonly executor: DatabaseSession;
  readonly knownPaths?: Readonly<Record<string, readonly string[]>> | undefined;
}): Promise<Readonly<Record<string, readonly string[]>>> {
  const result: Record<string, readonly string[]> = {
    ...(input.knownPaths ?? {}),
  };
  const missing = uniqueSortedStrings(
    input.containerIds.filter((id) => result[id] === undefined),
  );
  if (missing.length === 0) return result;

  const queryResult = await input.executor.execute(sql`
    with recursive ancestor_chain as (
      select
        c.id,
        c.parent_id,
        ${visitedPathStart(sql`c.id`)} as visited_path,
        false as cycle_detected,
        0 as depth
      from ${containers} c
      where c.id in (${sql.join(
        missing.map((id) => sql`${id}`),
        sql`, `,
      )})
      union all
      select
        parent.id,
        parent.parent_id,
        ${visitedPathAppend(sql`chain.visited_path`, sql`parent.id`)},
        ${visitedPathContains(sql`chain.visited_path`, sql`parent.id`)} as cycle_detected,
        chain.depth + 1
      from ancestor_chain chain
      inner join ${containers} parent on parent.id = chain.parent_id
      where not chain.cycle_detected
        and chain.depth < ${MAX_CONTAINER_PATH_LENGTH - 1}
        and chain.parent_id is not null
    )
    select distinct
      ${textExpression(sql`id`)} as "id",
      ${textExpression(sql`parent_id`)} as "parentId"
    from ancestor_chain
    where not cycle_detected
  `);

  const parentById = new Map<string, string | null>();
  for (const row of queryResult.rows) {
    const parsed = ancestorEdgeRowSchema.safeParse(row);
    if (parsed.success) {
      parentById.set(parsed.data.id, parsed.data.parentId);
    }
  }
  for (const id of missing) {
    const path = buildPathFromParents(id, parentById);
    if (path) result[id] = path;
  }
  return result;
}
