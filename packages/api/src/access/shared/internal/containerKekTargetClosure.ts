import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
} from "@tearleads/api-shared/schema";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { uniqueSortedStrings } from "../../../utils/array";
import {
  jsonTextProperty,
  uuidColumnEqualsJsonText,
  visitedPathAppend,
  visitedPathContains,
  visitedPathStart,
} from "../../../utils/postgresSql";
import {
  ContainerKekTargetError,
  type ContainerKekTargetStatus,
} from "./containerKekTargetError";
import {
  type ContainerManifestTarget,
  readContainerManifestTarget,
  sqlSafeInteger,
} from "./containerManifestTargetState";

const containerAncestorClosureRowSchema = z.object({
  cycleDetected: z.boolean(),
  depth: sqlSafeInteger,
  id: z.string(),
  manifestHash: z.string(),
  objectId: z.string(),
  objectKind: z.string(),
  state: z.unknown().optional(),
});

export async function loadCurrentContainerManifestTargetClosure(input: {
  readonly containerIds: readonly string[];
  readonly executor: DatabaseSession;
}): Promise<Map<string, ContainerManifestTarget>> {
  const seedContainerIds = uniqueSortedStrings(input.containerIds);
  // Validate the full ancestor chain from the signed current manifest heads.
  // Structural container rows cannot replace the signed KEK parent edge. The
  // recursive CTE keeps deep hierarchies to one round trip and fails closed on
  // missing, stale, malformed, or cyclic parent heads.
  const result = await input.executor.execute(sql`
    with recursive ancestor_path as (
      select
        h.object_id,
        h.manifest_hash,
        m.object_kind,
        m.object_id as manifest_object_id,
        m.state,
        ${visitedPathStart(sql`h.object_id`)} as visited_path,
        false as cycle_detected,
        0 as depth
      from ${accessManifestHeads} h
      inner join ${accessManifests} m on m.manifest_hash = h.manifest_hash
      where h.object_kind = 'container'
        and h.object_id in (${sql.join(
          seedContainerIds.map((containerId) => sql`${containerId}`),
          sql`, `,
        )})
      union all
      select
        h.object_id,
        h.manifest_hash,
        m.object_kind,
        m.object_id as manifest_object_id,
        m.state,
        ${visitedPathAppend(sql`ap.visited_path`, sql`h.object_id`)},
        ${visitedPathContains(
          sql`ap.visited_path`,
          sql`h.object_id`,
        )} as cycle_detected,
        ap.depth + 1
      from ancestor_path ap
      cross join ${accessManifestHeads} h
      inner join ${accessManifests} m on m.manifest_hash = h.manifest_hash
      where h.object_kind = 'container'
        and ${uuidColumnEqualsJsonText(
          sql`h.object_id`,
          jsonTextProperty(sql`ap.state`, "parentContainerId"),
        )}
        and not ap.cycle_detected
        and ap.depth < ${MAX_CONTAINER_PATH_LENGTH - 1}
        and ${jsonTextProperty(sql`ap.state`, "parentContainerId")} is not null
    )
    select
      object_id as "id",
      manifest_hash as "manifestHash",
      object_kind as "objectKind",
      manifest_object_id as "objectId",
      state as "state",
      depth as "depth",
      cycle_detected as "cycleDetected"
    from ancestor_path
    order by object_id asc
  `);
  const targetByContainerId = new Map<string, ContainerManifestTarget>();

  for (const value of result.rows) {
    const parsed = containerAncestorClosureRowSchema.safeParse(value);
    if (!parsed.success) {
      throw new ContainerKekTargetError(
        "Unexpected row shape from container ancestor KEK closure",
        409,
      );
    }
    const row = parsed.data;
    if (row.cycleDetected) {
      throw new ContainerKekTargetError(
        `Container parent cycle detected at container ${row.id}`,
        409,
      );
    }
    if (row.objectKind !== "container" || row.objectId !== row.id) {
      throw new ContainerKekTargetError(
        "Container manifest bundle mismatch",
        409,
      );
    }
    const target = readContainerManifestTarget({
      containerId: row.id,
      state: row.state,
    });
    if (
      row.depth >= MAX_CONTAINER_PATH_LENGTH - 1 &&
      target.parentContainerId !== null
    )
      throw new ContainerKekTargetError(
        "Container path exceeds maximum depth",
        409,
      );
    if (targetByContainerId.has(row.id)) continue;
    targetByContainerId.set(row.id, {
      containerId: row.id,
      containerManifestHash: row.manifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      parentContainerId: target.parentContainerId,
    });
  }

  return targetByContainerId;
}

function assertContainerAncestorClosureIsComplete(
  targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>,
): void {
  for (const target of targetByContainerId.values()) {
    if (
      target.parentContainerId !== null &&
      !targetByContainerId.has(target.parentContainerId)
    ) {
      throw new ContainerKekTargetError(
        `Container KEK parent target is missing for container ${target.containerId} (parent: ${target.parentContainerId})`,
        409,
      );
    }
  }
}

export async function listCurrentContainerKekTargetClosureIdsMapped<
  E extends Error,
>(
  containerIds: readonly string[],
  executor: DatabaseSession,
  mapError: (message: string, status: ContainerKekTargetStatus) => E,
): Promise<string[]> {
  try {
    const uniqueContainerIds = uniqueSortedStrings(containerIds);
    if (uniqueContainerIds.length === 0) {
      return [];
    }
    const targetByContainerId: Map<string, ContainerManifestTarget> =
      await loadCurrentContainerManifestTargetClosure({
        containerIds: uniqueContainerIds,
        executor,
      });
    if (
      uniqueContainerIds.some(
        (containerId) => !targetByContainerId.has(containerId),
      )
    ) {
      throw new ContainerKekTargetError("Container manifest head missing", 409);
    }
    assertContainerAncestorClosureIsComplete(targetByContainerId);
    return uniqueSortedStrings([...targetByContainerId.keys()]);
  } catch (error) {
    if (error instanceof ContainerKekTargetError) {
      throw mapError(error.message, error.status);
    }
    throw error;
  }
}
