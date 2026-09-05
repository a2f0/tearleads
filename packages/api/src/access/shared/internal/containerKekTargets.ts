import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
} from "@tearleads/api-shared/schema";
import type { ContainerKekTarget } from "@tearleads/crypto";
import { sql } from "drizzle-orm";
import { uniqueSortedStrings as unique } from "../../../utils/array";
import { isRecord } from "../../../utils/record";
import {
  isSqlBooleanValue,
  jsonTextProperty,
  readSqlBoolean,
  textExpression,
  uuidExpression,
  visitedPathAppend,
  visitedPathContains,
  visitedPathStart,
} from "../../../utils/sqlDialect";
import { getContainerKeyEpochsById } from "./containerKekStore";

export const MAX_SAME_EPOCH_MANIFEST_HISTORY = 1024;

export type ContainerKekTargetStatus = 404 | 409;

export class ContainerKekTargetError extends Error {
  constructor(
    message: string,
    readonly status: ContainerKekTargetStatus,
  ) {
    super(message);
    this.name = "ContainerKekTargetError";
  }
}

type ContainerKeyEpochById = Awaited<
  ReturnType<typeof getContainerKeyEpochsById>
>;

const staleContainerKekEpochError = (containerId: string) =>
  new ContainerKekTargetError(
    `Container KEK epoch is stale for container ${containerId}`,
    409,
  );

const staleContainerKekParentEdgeError = (containerId: string) =>
  new ContainerKekTargetError(
    `Container KEK parent edge is stale for container ${containerId}`,
    409,
  );

export async function resolveCurrentContainerKekTargetsMapped<E extends Error>(
  containerIds: readonly string[],
  executor: DatabaseSession,
  mapError: (message: string, status: ContainerKekTargetStatus) => E,
): Promise<Map<string, ContainerKekTarget>> {
  try {
    return await resolveCurrentContainerKekTargets(containerIds, executor);
  } catch (error) {
    if (error instanceof ContainerKekTargetError) {
      throw mapError(error.message, error.status);
    }
    throw error;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readContainerManifestTarget(input: {
  readonly containerId: string;
  readonly state: unknown;
}): Pick<ContainerManifestTarget, "containerKeyEpochId" | "parentContainerId"> {
  const state = readRecord(input.state);
  if (!state) {
    throw new ContainerKekTargetError(
      "Container manifest state is invalid",
      409,
    );
  }

  const version = Reflect.get(state, "version");
  const stateContainerId = Reflect.get(state, "containerId");
  if (version !== 1 || stateContainerId !== input.containerId) {
    throw new ContainerKekTargetError("Container manifest state mismatch", 409);
  }

  const containerKeyEpochId = Reflect.get(state, "containerKeyEpochId");
  if (typeof containerKeyEpochId !== "string" || !containerKeyEpochId) {
    throw new ContainerKekTargetError(
      "Container manifest has no current KEK epoch",
      409,
    );
  }

  const parentContainerValue = Reflect.get(state, "parentContainerId");
  const parentContainerId = readNullableString(parentContainerValue);
  if (parentContainerId === null && parentContainerValue !== null) {
    throw new ContainerKekTargetError(
      "Container manifest parent is invalid",
      409,
    );
  }

  return { containerKeyEpochId, parentContainerId };
}

export type ContainerManifestTarget = {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly containerManifestHash: string;
  readonly parentContainerId: string | null;
};

interface ContainerAncestorClosureRow {
  readonly cycleDetected: boolean;
  readonly id: string;
  readonly manifestHash: string;
  readonly objectId: string;
  readonly objectKind: string;
  readonly state: unknown;
}

function isContainerAncestorClosureRow(
  value: unknown,
): value is ContainerAncestorClosureRow {
  return (
    typeof value === "object" &&
    value !== null &&
    isSqlBooleanValue(Reflect.get(value, "cycleDetected")) &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "manifestHash") === "string" &&
    typeof Reflect.get(value, "objectId") === "string" &&
    typeof Reflect.get(value, "objectKind") === "string"
  );
}

interface ContainerManifestBindingHistoryRow {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly depth: number;
  readonly eventHash: string;
  readonly manifestHash: string;
  readonly objectId: string;
  readonly objectKind: string;
  readonly previousManifestHash: string | null;
  readonly state: unknown;
}

function isContainerManifestBindingHistoryRow(
  value: unknown,
): value is ContainerManifestBindingHistoryRow {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "containerId") === "string" &&
    typeof Reflect.get(value, "containerKeyEpochId") === "string" &&
    Number.isSafeInteger(Reflect.get(value, "depth")) &&
    typeof Reflect.get(value, "eventHash") === "string" &&
    typeof Reflect.get(value, "manifestHash") === "string" &&
    typeof Reflect.get(value, "objectId") === "string" &&
    typeof Reflect.get(value, "objectKind") === "string" &&
    (typeof Reflect.get(value, "previousManifestHash") === "string" ||
      Reflect.get(value, "previousManifestHash") === null)
  );
}

interface ContainerManifestBindingHistory {
  readonly eventHashByManifestHash: Map<string, string>;
  readonly manifestHashes: Set<string>;
}

export async function loadCurrentContainerManifestTargetClosure(input: {
  readonly containerIds: readonly string[];
  readonly executor: DatabaseSession;
}): Promise<Map<string, ContainerManifestTarget>> {
  const seedContainerIds = unique(input.containerIds);
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
      inner join ${accessManifestHeads} h
        on h.object_kind = 'container'
        and ${textExpression(sql`h.object_id`)} = ${jsonTextProperty(
          sql`ap.state`,
          "parentContainerId",
        )}
      inner join ${accessManifests} m on m.manifest_hash = h.manifest_hash
      where not ap.cycle_detected
        and ap.depth < 100
        and ${jsonTextProperty(sql`ap.state`, "parentContainerId")} is not null
    )
    select
      object_id as "id",
      manifest_hash as "manifestHash",
      object_kind as "objectKind",
      manifest_object_id as "objectId",
      state as "state",
      cycle_detected as "cycleDetected"
    from ancestor_path
    order by object_id asc
  `);
  const targetByContainerId = new Map<string, ContainerManifestTarget>();

  for (const row of result.rows) {
    if (!isContainerAncestorClosureRow(row)) {
      throw new ContainerKekTargetError(
        "Unexpected row shape from container ancestor KEK closure",
        409,
      );
    }
    const cycleDetected = readSqlBoolean(row.cycleDetected, "cycleDetected");
    if (cycleDetected) {
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
    if (targetByContainerId.has(row.id)) {
      continue;
    }
    const target = readContainerManifestTarget({
      containerId: row.id,
      state: row.state,
    });
    targetByContainerId.set(row.id, {
      containerId: row.id,
      containerManifestHash: row.manifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      parentContainerId: target.parentContainerId,
    });
  }

  return targetByContainerId;
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

  const state = readRecord(input.row.state);
  if (!state) {
    throw new ContainerKekTargetError(
      "Container manifest state is invalid",
      409,
    );
  }

  const previousManifestValue = Reflect.get(state, "previousManifestHash");
  const previousManifestHash = readNullableString(previousManifestValue);
  if (
    (previousManifestHash === null && previousManifestValue !== null) ||
    previousManifestHash !== input.row.previousManifestHash
  ) {
    throw new ContainerKekTargetError(
      "Container manifest history mismatch",
      409,
    );
  }
}

async function loadSameEpochContainerManifestBindingHistories(input: {
  readonly executor: DatabaseSession;
  readonly targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>;
}): Promise<Map<string, ContainerManifestBindingHistory>> {
  const targets = [...input.targetByContainerId.values()].sort((left, right) =>
    left.containerId.localeCompare(right.containerId),
  );

  if (targets.length === 0) {
    return new Map();
  }

  // One sentinel detects overflow. Bounded rows detect cycles below without
  // quadratic visited-path strings in SQL.
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

  for (const row of result.rows) {
    if (!isContainerManifestBindingHistoryRow(row)) {
      throw new ContainerKekTargetError(
        "Unexpected row shape from container manifest binding history",
        409,
      );
    }

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

function getContainerKeyEpoch(
  target: ContainerManifestTarget,
  keyEpochById: ContainerKeyEpochById,
) {
  const keyEpoch = keyEpochById.get(target.containerKeyEpochId);
  if (!keyEpoch) {
    throw new ContainerKekTargetError(
      `Container KEK epoch missing for container ${target.containerId}`,
      409,
    );
  }
  if (keyEpoch.containerId !== target.containerId) {
    throw staleContainerKekEpochError(target.containerId);
  }

  return keyEpoch;
}

function assertContainerKekParentEdgesCurrent(input: {
  readonly keyEpochById: ContainerKeyEpochById;
  readonly targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>;
}): void {
  for (const target of input.targetByContainerId.values()) {
    const keyEpoch = getContainerKeyEpoch(target, input.keyEpochById);

    if (target.parentContainerId === null) {
      if (keyEpoch.parentContainerKeyEpochId !== null) {
        throw staleContainerKekParentEdgeError(target.containerId);
      }
      continue;
    }

    const parentTarget = input.targetByContainerId.get(
      target.parentContainerId,
    );
    if (!parentTarget) {
      throw new ContainerKekTargetError(
        `Container KEK parent target is missing for container ${target.containerId} (parent: ${target.parentContainerId})`,
        409,
      );
    }

    // Future document/blob writes must not keep using a descendant KEK that is
    // still reachable through an older ancestor KEK. The writer projection route
    // intentionally remains available so an authorized client can materialize a
    // signed container.rekey repair before retrying the content write.
    if (
      keyEpoch.parentContainerKeyEpochId !== parentTarget.containerKeyEpochId
    ) {
      throw staleContainerKekParentEdgeError(target.containerId);
    }
  }
}

function assertContainerKekManifestBindingsCurrent(input: {
  readonly historyByContainerId: ReadonlyMap<
    string,
    ContainerManifestBindingHistory
  >;
  readonly keyEpochById: ContainerKeyEpochById;
  readonly targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>;
}): void {
  for (const target of input.targetByContainerId.values()) {
    const keyEpoch = getContainerKeyEpoch(target, input.keyEpochById);
    const history = input.historyByContainerId.get(target.containerId);

    if (
      !history?.manifestHashes.has(keyEpoch.accessManifestHash) ||
      !history.manifestHashes.has(keyEpoch.createdByManifestHash) ||
      history.eventHashByManifestHash.get(keyEpoch.createdByManifestHash) !==
        keyEpoch.createdByEventHash
    ) {
      throw staleContainerKekEpochError(target.containerId);
    }
  }
}

export async function resolveCurrentContainerKekTargets(
  containerIds: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, ContainerKekTarget>> {
  const uniqueContainerIds = unique(containerIds);

  if (uniqueContainerIds.length === 0) {
    return new Map();
  }

  const targetByContainerId = await loadCurrentContainerManifestTargetClosure({
    containerIds: uniqueContainerIds,
    executor,
  });
  const keyEpochById = await getContainerKeyEpochsById(
    [...targetByContainerId.values()].map(
      (target) => target.containerKeyEpochId,
    ),
    executor,
  );
  assertContainerKekParentEdgesCurrent({ keyEpochById, targetByContainerId });
  const historyByContainerId =
    await loadSameEpochContainerManifestBindingHistories({
      executor,
      targetByContainerId,
    });
  assertContainerKekManifestBindingsCurrent({
    historyByContainerId,
    keyEpochById,
    targetByContainerId,
  });

  return new Map(
    uniqueContainerIds.map((containerId) => {
      const target = targetByContainerId.get(containerId);
      if (!target) {
        throw new ContainerKekTargetError(
          "Container manifest head missing",
          409,
        );
      }
      const keyEpoch = getContainerKeyEpoch(target, keyEpochById);

      return [
        target.containerId,
        {
          containerId: target.containerId,
          containerManifestHash: target.containerManifestHash,
          containerKeyEpochId: keyEpoch.id,
          containerKeyEpoch: keyEpoch.keyEpoch,
        },
      ] as const;
    }),
  );
}
