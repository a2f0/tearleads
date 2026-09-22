import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH } from "@tearleads/validators/util";
import { sql } from "drizzle-orm";
import { uuidValue } from "../../../../utils/sqlDialect";
import { ContainerMutationError } from "../errors";

/**
 * A carried rekey rides a rotation above it: the refusal that names it says
 * "descendant", and the server holds the batch to that word. Each carried
 * container must have one of the batch's rotated containers as a proper
 * ancestor, within the path depth limit. Authorization is enforced per
 * mutation regardless; this refuses an unrelated rekey from riding a
 * rotation's transaction, and a rotation's own container from being "carried".
 * A container that does not exist gets the same refusal as an unrelated one,
 * deliberately: the answer must not say whether an id is real.
 */
export async function assertCarriedRekeysBelowRotations(input: {
  readonly carriedContainerIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly rotatedContainerIds: readonly string[];
}): Promise<void> {
  const carried = [...new Set(input.carriedContainerIds)];
  const rotated = [...new Set(input.rotatedContainerIds)];
  if (carried.length === 0) return;
  // Unreachable from today's callers, which always rotate something first;
  // kept so a carried entry can never ride an empty rotated set.
  if (rotated.length === 0) {
    throw new ContainerMutationError(
      "Carried container rekey is not below the rotated container",
      409,
    );
  }
  const result = await input.executor.execute(sql`
    with recursive ancestry as (
      select ${containers.id} as start_id, ${containers.parentId} as parent_id,
             0 as distance
      from ${containers}
      where ${containers.id} in (${sql.join(
        carried.map((containerId) => uuidValue(containerId)),
        sql`, `,
      )})
      union all
      select ancestry.start_id, parent.parent_id, ancestry.distance + 1
      from ${containers} parent
      inner join ancestry on parent.id = ancestry.parent_id
      where ancestry.distance < ${MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH}
    )
    select distinct start_id
    from ancestry
    where parent_id in (${sql.join(
      rotated.map((containerId) => uuidValue(containerId)),
      sql`, `,
    )})
  `);
  const below = new Set<string>();
  for (const row of result.rows) {
    const startId = Reflect.get(row, "start_id");
    if (typeof startId === "string") below.add(startId);
  }
  if (carried.some((containerId) => !below.has(containerId))) {
    throw new ContainerMutationError(
      "Carried container rekey is not below the rotated container",
      409,
    );
  }
}
