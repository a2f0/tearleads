import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../adapters/postgres";
import { containers, objectAccessEpochs, objectAccessGrants } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import { computeAccessFingerprint } from "./accessFingerprint";

const CONTAINER_OBJECT_TYPE = "container";
const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

type AccessLevel = "read" | "write" | "admin";
type SubjectType = "user" | "group" | "organization";
type ContainerAccessTransaction = Parameters<
  (typeof db)["transaction"]
>[0] extends (tx: infer T) => Promise<unknown>
  ? T
  : never;
type ContainerAccessExecutor = typeof db | ContainerAccessTransaction;

interface EffectiveContainerRecipient {
  userId: string;
  accessLevel: AccessLevel;
  encapsulationPublicKey: string;
  keyFingerprint: string;
}

interface GrantedRecipientRow {
  userId: string;
  accessLevel: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
}

interface AncestorContainerRow {
  id: string;
  cycleDetected: boolean;
}

interface DescendantContainerRow {
  id: string;
  depth: number;
}

interface ContainerAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  ancestorContainerIds: string[];
  grants: Array<{
    objectId: string;
    subjectType: string;
    subjectId: string;
    accessLevel: string;
  }>;
  effectiveRecipients: EffectiveContainerRecipient[];
}

function isAccessLevel(value: string): value is AccessLevel {
  return value === "read" || value === "write" || value === "admin";
}

function isUuidString(value: string): boolean {
  return new RegExp(UUID_PATTERN).test(value);
}

function accessLevelRank(accessLevel: AccessLevel): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

function mergeAccessLevel(
  current: AccessLevel | undefined,
  incoming: AccessLevel,
): AccessLevel {
  if (!current) {
    return incoming;
  }

  return accessLevelRank(incoming) > accessLevelRank(current)
    ? incoming
    : current;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function isGrantedRecipientRow(value: unknown): value is GrantedRecipientRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "userId") === "string" &&
    typeof Reflect.get(value, "accessLevel") === "string" &&
    typeof Reflect.get(value, "encapsulationPublicKey") === "string" &&
    typeof Reflect.get(value, "encapsulationKeyFingerprint") === "string"
  );
}

function isAncestorContainerRow(value: unknown): value is AncestorContainerRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "cycleDetected") === "boolean"
  );
}

function isDescendantContainerRow(
  value: unknown,
): value is DescendantContainerRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "depth") === "number"
  );
}

async function getCurrentEpochRow(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<{ epoch: number; accessFingerprint: string } | null> {
  const [row] = await executor
    .select({
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, CONTAINER_OBJECT_TYPE),
        eq(objectAccessEpochs.objectId, containerId),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch))
    .limit(1);

  return row ?? null;
}

async function listDescendantContainerIds(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<string[]> {
  const result = await executor.execute(sql`
    with recursive descendants as (
      select
        c.id,
        0 as depth
      from ${containers} c
      where c.id = ${containerId}
      union all
      select
        child.id,
        descendants.depth + 1 as depth
      from ${containers} child
      inner join descendants on child.parent_id = descendants.id
      where descendants.depth < 100
    )
    select
      id::text as "id",
      depth as "depth"
    from descendants
    order by depth asc, id asc
  `);

  const descendantIds: string[] = [];

  for (const row of result.rows) {
    if (!isDescendantContainerRow(row)) {
      throw new Error("Unexpected row shape from descendants CTE");
    }

    descendantIds.push(row.id);
  }

  return descendantIds;
}

async function writeEpoch(
  containerId: string,
  epoch: number,
  accessFingerprint: string,
  executor: ContainerAccessExecutor = db,
) {
  await executor.insert(objectAccessEpochs).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: containerId,
    epoch,
    accessFingerprint,
    updatedAt: new Date(),
  });
}

export async function initializeContainerAccess(
  containerId: string,
  executor: ContainerAccessExecutor = db,
  options: {
    inheritedFrom?: ContainerAccessState;
  } = {},
): Promise<number> {
  const currentEpochRow = await getCurrentEpochRow(containerId, executor);
  if (currentEpochRow) {
    return currentEpochRow.epoch;
  }

  const inheritedState = options.inheritedFrom;
  const { ancestorContainerIds, effectiveRecipients, grants } = inheritedState
    ? {
        ancestorContainerIds: [
          ...inheritedState.ancestorContainerIds,
          containerId,
        ],
        effectiveRecipients: inheritedState.effectiveRecipients,
        grants: inheritedState.grants,
      }
    : await resolveContainerRecipients(containerId, executor);
  const accessFingerprint = await computeContainerFingerprint({
    containerId,
    ancestorContainerIds,
    grants,
    effectiveRecipients,
  });

  const initialEpoch = 1;
  await writeEpoch(containerId, initialEpoch, accessFingerprint, executor);
  return initialEpoch;
}

async function listAncestorContainerIds(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<string[]> {
  const result = await executor.execute(sql`
    with recursive ancestor_path as (
      select
        c.id,
        c.parent_id,
        array[c.id::text] as visited_ids,
        false as cycle_detected,
        0 as depth
      from ${containers} c
      where c.id = ${containerId}
      union all
      select
        parent.id,
        parent.parent_id,
        ap.visited_ids || parent.id::text,
        parent.id::text = any(ap.visited_ids) as cycle_detected,
        ap.depth + 1
      from ${containers} parent
      inner join ancestor_path ap on parent.id = ap.parent_id
      where not ap.cycle_detected and ap.depth < 100
    )
    select
      id::text as "id",
      cycle_detected as "cycleDetected"
    from ancestor_path
    order by depth desc
  `);

  if (result.rows.length === 0) {
    throw new Error(`Container ${containerId} does not exist`);
  }

  const path: string[] = [];

  for (const row of result.rows) {
    if (!isAncestorContainerRow(row)) {
      throw new Error("Unexpected row shape from ancestor_path CTE");
    }

    if (row.cycleDetected) {
      throw new Error(`Container parent cycle detected at ${row.id}`);
    }

    path.push(row.id);
  }

  return path;
}

async function loadContainerGrantRows(
  containerIds: string[],
  executor: ContainerAccessExecutor = db,
) {
  if (containerIds.length === 0) {
    return [];
  }

  return executor
    .select({
      objectId: objectAccessGrants.objectId,
      subjectType: objectAccessGrants.subjectType,
      subjectId: objectAccessGrants.subjectId,
      accessLevel: objectAccessGrants.accessLevel,
    })
    .from(objectAccessGrants)
    .where(
      and(
        eq(objectAccessGrants.objectType, CONTAINER_OBJECT_TYPE),
        inArray(objectAccessGrants.objectId, containerIds),
      ),
    );
}

async function loadGrantedRecipients(
  containerIds: string[],
  executor: ContainerAccessExecutor = db,
) {
  if (containerIds.length === 0) {
    return [];
  }

  const safeSubjectUuid = sql`substring(g.subject_id from ${UUID_PATTERN})::uuid`;
  const objectIdList = sql.join(
    containerIds.map((containerId) => sql`${containerId}`),
    sql`, `,
  );

  const result = await executor.execute(sql`
    select
      u.id as "userId",
      g.access_level as "accessLevel",
      u.encapsulation_public_key as "encapsulationPublicKey",
      u.encapsulation_key_fingerprint as "encapsulationKeyFingerprint"
    from object_access_grants g
    inner join users u on u.id = ${safeSubjectUuid}
    where
      g.object_type = ${CONTAINER_OBJECT_TYPE}
      and g.subject_type = ${"user"}
      and g.object_id in (${objectIdList})
    union all
    select
      u.id as "userId",
      g.access_level as "accessLevel",
      u.encapsulation_public_key as "encapsulationPublicKey",
      u.encapsulation_key_fingerprint as "encapsulationKeyFingerprint"
    from object_access_grants g
    inner join organization_members om on om.organization_id = ${safeSubjectUuid}
    inner join users u on u.id = om.user_id
    where
      g.object_type = ${CONTAINER_OBJECT_TYPE}
      and g.subject_type = ${"organization"}
      and g.object_id in (${objectIdList})
    union all
    select
      u.id as "userId",
      g.access_level as "accessLevel",
      u.encapsulation_public_key as "encapsulationPublicKey",
      u.encapsulation_key_fingerprint as "encapsulationKeyFingerprint"
    from object_access_grants g
    inner join group_members gm on gm.group_id = ${safeSubjectUuid}
    inner join users u on u.id = gm.user_id
    where
      g.object_type = ${CONTAINER_OBJECT_TYPE}
      and g.subject_type = ${"group"}
      and g.object_id in (${objectIdList})
  `);

  const grantedRecipients: GrantedRecipientRow[] = [];

  for (const row of result.rows) {
    if (!isGrantedRecipientRow(row)) {
      continue;
    }

    grantedRecipients.push({
      userId: Reflect.get(row, "userId"),
      accessLevel: Reflect.get(row, "accessLevel"),
      encapsulationPublicKey: Reflect.get(row, "encapsulationPublicKey"),
      encapsulationKeyFingerprint: Reflect.get(
        row,
        "encapsulationKeyFingerprint",
      ),
    });
  }

  return grantedRecipients;
}

async function resolveContainerRecipients(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<{
  ancestorContainerIds: string[];
  effectiveRecipients: EffectiveContainerRecipient[];
  grants: Array<{
    objectId: string;
    subjectType: string;
    subjectId: string;
    accessLevel: string;
  }>;
}> {
  const ancestorContainerIds = await listAncestorContainerIds(
    containerId,
    executor,
  );
  const grants = await loadContainerGrantRows(ancestorContainerIds, executor);
  const grantedRecipients = await loadGrantedRecipients(
    ancestorContainerIds,
    executor,
  );

  const effectiveAccessByUserId = new Map<string, AccessLevel>();
  const encapsulationPublicKeyByUserId = new Map<string, string>();
  const keyFingerprintByUserId = new Map<string, string>();

  for (const recipient of grantedRecipients) {
    if (
      !isAccessLevel(recipient.accessLevel) ||
      recipient.encapsulationPublicKey.length === 0
    ) {
      continue;
    }

    effectiveAccessByUserId.set(
      recipient.userId,
      mergeAccessLevel(
        effectiveAccessByUserId.get(recipient.userId),
        recipient.accessLevel,
      ),
    );
    encapsulationPublicKeyByUserId.set(
      recipient.userId,
      recipient.encapsulationPublicKey,
    );
    if (recipient.encapsulationKeyFingerprint.length > 0) {
      keyFingerprintByUserId.set(
        recipient.userId,
        recipient.encapsulationKeyFingerprint,
      );
    }
  }

  const effectiveUserIds = uniqueSortedStrings(
    Array.from(effectiveAccessByUserId.keys()),
  );

  const effectiveRecipients = (
    await Promise.all(
      effectiveUserIds.map(async (userId) => {
        const accessLevel = effectiveAccessByUserId.get(userId);
        const encapsulationPublicKey =
          encapsulationPublicKeyByUserId.get(userId);
        const keyFingerprint = keyFingerprintByUserId.get(userId);

        if (!accessLevel || !encapsulationPublicKey || !keyFingerprint) {
          return null;
        }

        return {
          userId,
          accessLevel,
          encapsulationPublicKey,
          keyFingerprint,
        };
      }),
    )
  ).filter(isPresent);

  effectiveRecipients.sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return { ancestorContainerIds, effectiveRecipients, grants };
}

async function computeContainerFingerprint(input: {
  containerId: string;
  ancestorContainerIds: string[];
  grants: Array<{
    objectId: string;
    subjectType: string;
    subjectId: string;
    accessLevel: string;
  }>;
  effectiveRecipients: EffectiveContainerRecipient[];
}) {
  return computeAccessFingerprint({
    objectType: CONTAINER_OBJECT_TYPE,
    containerId: input.containerId,
    ancestorContainerIds: input.ancestorContainerIds,
    grants: input.grants
      .map((grant) => ({
        objectId: grant.objectId,
        subjectType: grant.subjectType,
        subjectId: grant.subjectId,
        accessLevel: grant.accessLevel,
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
    recipients: input.effectiveRecipients.map((recipient) => ({
      userId: recipient.userId,
      accessLevel: recipient.accessLevel,
      keyFingerprint: recipient.keyFingerprint,
    })),
  });
}

async function refreshContainerAccessEpoch(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<number> {
  const currentEpochRow = await getCurrentEpochRow(containerId, executor);
  const { ancestorContainerIds, effectiveRecipients, grants } =
    await resolveContainerRecipients(containerId, executor);
  const accessFingerprint = await computeContainerFingerprint({
    containerId,
    ancestorContainerIds,
    grants,
    effectiveRecipients,
  });

  if (
    currentEpochRow &&
    currentEpochRow.accessFingerprint === accessFingerprint
  ) {
    return currentEpochRow.epoch;
  }

  const nextEpoch = currentEpochRow === null ? 1 : currentEpochRow.epoch + 1;
  await writeEpoch(containerId, nextEpoch, accessFingerprint, executor);
  return nextEpoch;
}

async function refreshContainerAccessSubtree(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<Map<string, number>> {
  const descendantIds = await listDescendantContainerIds(containerId, executor);
  const epochByContainerId = new Map<string, number>();

  for (const descendantId of descendantIds) {
    const epoch = await refreshContainerAccessEpoch(descendantId, executor);
    epochByContainerId.set(descendantId, epoch);
  }

  return epochByContainerId;
}

export async function grantContainerAccess(
  input: {
    containerId: string;
    subjectType: SubjectType;
    subjectId: string;
    accessLevel: AccessLevel;
  },
  executor: ContainerAccessExecutor = db,
): Promise<number> {
  if (!isUuidString(input.subjectId)) {
    throw new Error(
      `Container grant subjectId must be a UUID for subjectType ${input.subjectType}`,
    );
  }

  const grantAccess = async (tx: ContainerAccessExecutor) => {
    await tx
      .delete(objectAccessGrants)
      .where(
        and(
          eq(objectAccessGrants.objectType, CONTAINER_OBJECT_TYPE),
          eq(objectAccessGrants.objectId, input.containerId),
          eq(objectAccessGrants.subjectType, input.subjectType),
          eq(objectAccessGrants.subjectId, input.subjectId),
        ),
      );

    await tx.insert(objectAccessGrants).values({
      objectType: CONTAINER_OBJECT_TYPE,
      objectId: input.containerId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      accessLevel: input.accessLevel,
    });

    const epochByContainerId = await refreshContainerAccessSubtree(
      input.containerId,
      tx,
    );

    return epochByContainerId.get(input.containerId) ?? 1;
  };

  if (executor === db) {
    return db.transaction(grantAccess);
  }

  return grantAccess(executor);
}

export async function resolveContainerAccessState(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<ContainerAccessState | null> {
  const currentEpochRow = await getCurrentEpochRow(containerId, executor);
  if (!currentEpochRow) {
    return null;
  }

  const { ancestorContainerIds, effectiveRecipients, grants } =
    await resolveContainerRecipients(containerId, executor);
  const accessFingerprint = await computeContainerFingerprint({
    containerId,
    ancestorContainerIds,
    grants,
    effectiveRecipients,
  });

  return {
    currentAccessEpoch: currentEpochRow.epoch,
    accessFingerprint,
    ancestorContainerIds,
    grants,
    effectiveRecipients,
  };
}

export function canReadContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) => recipient.userId === userId,
  );
}

export function canWriteContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      recipient.userId === userId &&
      accessLevelRank(recipient.accessLevel) >= accessLevelRank("write"),
  );
}

export function canAdminContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      recipient.userId === userId && recipient.accessLevel === "admin",
  );
}
