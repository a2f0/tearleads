import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../adapters/postgres";
import { objectAccessEpochs, objectAccessGrants } from "../schema";
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
}

interface AncestorContainerRow {
  id: string;
  cycleDetected: boolean;
}

interface ContainerAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  ancestorContainerIds: string[];
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

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
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
    typeof Reflect.get(value, "encapsulationPublicKey") === "string"
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
      from containers c
      where c.id = ${containerId}
      union all
      select
        parent.id,
        parent.parent_id,
        ap.visited_ids || parent.id::text,
        parent.id::text = any(ap.visited_ids) as cycle_detected,
        ap.depth + 1
      from containers parent
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
      u.encapsulation_public_key as "encapsulationPublicKey"
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
      u.encapsulation_public_key as "encapsulationPublicKey"
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
      u.encapsulation_public_key as "encapsulationPublicKey"
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

        if (!accessLevel || !encapsulationPublicKey) {
          return null;
        }

        return {
          userId,
          accessLevel,
          encapsulationPublicKey,
          keyFingerprint: await toFingerprint(
            base64ToBytes(encapsulationPublicKey),
          ),
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

export async function grantContainerAccess(input: {
  containerId: string;
  subjectType: SubjectType;
  subjectId: string;
  accessLevel: AccessLevel;
}): Promise<number> {
  if (!isUuidString(input.subjectId)) {
    throw new Error(
      `Container grant subjectId must be a UUID for subjectType ${input.subjectType}`,
    );
  }

  return db.transaction(async (tx) => {
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

    const currentEpochRow = await getCurrentEpochRow(input.containerId, tx);
    const nextEpoch = currentEpochRow === null ? 1 : currentEpochRow.epoch + 1;
    const { ancestorContainerIds, effectiveRecipients, grants } =
      await resolveContainerRecipients(input.containerId, tx);
    const accessFingerprint = await computeContainerFingerprint({
      containerId: input.containerId,
      ancestorContainerIds,
      grants,
      effectiveRecipients,
    });

    await writeEpoch(input.containerId, nextEpoch, accessFingerprint, tx);
    return nextEpoch;
  });
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
