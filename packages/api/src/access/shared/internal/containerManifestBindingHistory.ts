import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessManifests } from "@tearleads/api-shared/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { jsonTextProperty, uuidExpression } from "../../../utils/sqlDialect";
import {
  ContainerKekTargetError,
  staleContainerKekEpochError,
} from "./containerKekTargetError";
import {
  type ContainerManifestTarget,
  readContainerManifestTarget,
  readStoredState,
  sqlSafeInteger,
  statePreviousManifestSchema,
} from "./containerManifestTargetState";

export const MAX_SAME_EPOCH_MANIFEST_HISTORY = 1024;

const containerManifestBindingHistoryRowSchema = z.object({
  containerId: z.string(),
  containerKeyEpochId: z.string(),
  depth: sqlSafeInteger,
  eventHash: z.string(),
  manifestHash: z.string(),
  objectId: z.string(),
  objectKind: z.string(),
  previousManifestHash: z.string().nullable(),
  state: z.unknown().optional(),
});

type ContainerManifestBindingHistoryRow = z.output<
  typeof containerManifestBindingHistoryRowSchema
>;

export interface ContainerManifestBindingHistory {
  readonly eventHashByManifestHash: Map<string, string>;
  readonly manifestHashes: Set<string>;
}

function assertBindingHistoryRowCurrent(input: {
  readonly row: ContainerManifestBindingHistoryRow;
  readonly targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>;
}): void {
  if (input.row.depth >= MAX_SAME_EPOCH_MANIFEST_HISTORY) {
    throw new ContainerKekTargetError(
      `Container same-epoch manifest history exceeds maximum depth for ${input.row.containerId}; rekey required`,
      409,
    );
  }

  const target = input.targetByContainerId.get(input.row.containerId);
  if (!target) {
    throw new ContainerKekTargetError(
      "Container manifest binding history target is missing",
      409,
    );
  }

  if (
    input.row.objectKind !== "container" ||
    input.row.objectId !== input.row.containerId ||
    input.row.containerKeyEpochId !== target.containerKeyEpochId
  ) {
    throw new ContainerKekTargetError(
      "Container manifest binding history mismatch",
      409,
    );
  }

  const targetState = readContainerManifestTarget({
    containerId: input.row.containerId,
    state: input.row.state,
  });
  if (targetState.containerKeyEpochId !== input.row.containerKeyEpochId) {
    throw staleContainerKekEpochError(input.row.containerId);
  }

  const previous = statePreviousManifestSchema.safeParse(
    readStoredState(input.row.state),
  );
  if (
    !previous.success ||
    previous.data.previousManifestHash !== input.row.previousManifestHash
  ) {
    throw new ContainerKekTargetError(
      "Container manifest history mismatch",
      409,
    );
  }
}

export async function loadSameEpochContainerManifestBindingHistories(input: {
  readonly executor: DatabaseSession;
  readonly targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>;
}): Promise<Map<string, ContainerManifestBindingHistory>> {
  const targets = [...input.targetByContainerId.values()].sort((left, right) =>
    left.containerId.localeCompare(right.containerId),
  );

  if (targets.length === 0) {
    return new Map();
  }

  // One overflow row bounds history and cycles; JS rejects duplicate hashes.
  // SQL rows never accumulate quadratic visited-path strings.
  const result = await input.executor.execute(sql`
    with recursive manifest_targets(
      container_id,
      container_key_epoch_id,
      manifest_hash
    ) as (
      values ${sql.join(
        targets.map(
          (target) =>
            sql`(${target.containerId}, ${target.containerKeyEpochId}, ${target.containerManifestHash})`,
        ),
        sql`, `,
      )}
    ),
    manifest_path as (
      select
        ${uuidExpression(sql`manifest_targets.container_id`)} as container_id,
        manifest_targets.container_key_epoch_id,
        m.manifest_hash,
        m.object_kind,
        m.object_id,
        m.event_hash,
        m.previous_manifest_hash,
        m.state,
        0 as depth
      from manifest_targets
      inner join ${accessManifests} m
        on m.manifest_hash = manifest_targets.manifest_hash
      union all
      select
        mp.container_id,
        mp.container_key_epoch_id,
        pm.manifest_hash,
        pm.object_kind,
        pm.object_id,
        pm.event_hash,
        pm.previous_manifest_hash,
        pm.state,
        mp.depth + 1
      from manifest_path mp
      inner join ${accessManifests} pm
        on pm.manifest_hash = mp.previous_manifest_hash
      where mp.depth < ${MAX_SAME_EPOCH_MANIFEST_HISTORY}
        and mp.previous_manifest_hash is not null
        and pm.object_kind = 'container'
        and pm.object_id = mp.container_id
        and ${jsonTextProperty(sql`pm.state`, "containerKeyEpochId")} =
          mp.container_key_epoch_id
    )
    select
      container_id as "containerId",
      container_key_epoch_id as "containerKeyEpochId",
      depth as "depth",
      event_hash as "eventHash",
      manifest_hash as "manifestHash",
      object_id as "objectId",
      object_kind as "objectKind",
      previous_manifest_hash as "previousManifestHash",
      state as "state"
    from manifest_path
    order by container_id asc, depth asc
  `);
  const historyByContainerId = new Map<
    string,
    ContainerManifestBindingHistory
  >();

  for (const value of result.rows) {
    const parsed = containerManifestBindingHistoryRowSchema.safeParse(value);
    if (!parsed.success) {
      throw new ContainerKekTargetError(
        "Unexpected row shape from container manifest binding history",
        409,
      );
    }
    const row = parsed.data;

    assertBindingHistoryRowCurrent({
      row,
      targetByContainerId: input.targetByContainerId,
    });

    const history = historyByContainerId.get(row.containerId) ?? {
      eventHashByManifestHash: new Map<string, string>(),
      manifestHashes: new Set<string>(),
    };
    if (history.manifestHashes.has(row.manifestHash)) {
      throw new ContainerKekTargetError(
        `Container manifest history cycle detected at container ${row.containerId}`,
        409,
      );
    }
    history.manifestHashes.add(row.manifestHash);
    history.eventHashByManifestHash.set(row.manifestHash, row.eventHash);
    historyByContainerId.set(row.containerId, history);
  }

  for (const target of targets) {
    const history = historyByContainerId.get(target.containerId);
    if (!history?.manifestHashes.has(target.containerManifestHash)) {
      throw staleContainerKekEpochError(target.containerId);
    }
  }

  return historyByContainerId;
}
