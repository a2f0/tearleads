import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../adapters/postgres";
import {
  containers,
  groupMembers,
  objectAccessEpochs,
  objectAccessGrants,
  organizationMembers,
  users,
} from "../schema";
import { computeAccessFingerprint } from "./accessFingerprint";

const CONTAINER_OBJECT_TYPE = "container";

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

interface ContainerAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  ancestorContainerIds: string[];
  effectiveRecipients: EffectiveContainerRecipient[];
}

function isAccessLevel(value: string): value is AccessLevel {
  return value === "read" || value === "write" || value === "admin";
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
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = containerId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`Container parent cycle detected at ${currentId}`);
    }
    visited.add(currentId);

    const [row] = await executor
      .select({
        id: containers.id,
        parentId: containers.parentId,
      })
      .from(containers)
      .where(eq(containers.id, currentId))
      .limit(1);

    if (!row) {
      throw new Error(`Container ${currentId} does not exist`);
    }

    path.push(row.id);
    currentId = row.parentId;
  }

  return path.reverse();
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

  const [directUserRecipients, organizationRecipients, groupRecipients] =
    await Promise.all([
      executor
        .select({
          userId: users.id,
          accessLevel: objectAccessGrants.accessLevel,
          encapsulationPublicKey: users.encapsulationPublicKey,
        })
        .from(objectAccessGrants)
        .innerJoin(
          users,
          eq(users.id, sql`${objectAccessGrants.subjectId}::uuid`),
        )
        .where(
          and(
            eq(objectAccessGrants.objectType, CONTAINER_OBJECT_TYPE),
            eq(objectAccessGrants.subjectType, "user"),
            inArray(objectAccessGrants.objectId, containerIds),
          ),
        ),
      executor
        .select({
          userId: users.id,
          accessLevel: objectAccessGrants.accessLevel,
          encapsulationPublicKey: users.encapsulationPublicKey,
        })
        .from(objectAccessGrants)
        .innerJoin(
          organizationMembers,
          eq(
            organizationMembers.organizationId,
            sql`${objectAccessGrants.subjectId}::uuid`,
          ),
        )
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(objectAccessGrants.objectType, CONTAINER_OBJECT_TYPE),
            eq(objectAccessGrants.subjectType, "organization"),
            inArray(objectAccessGrants.objectId, containerIds),
          ),
        ),
      executor
        .select({
          userId: users.id,
          accessLevel: objectAccessGrants.accessLevel,
          encapsulationPublicKey: users.encapsulationPublicKey,
        })
        .from(objectAccessGrants)
        .innerJoin(
          groupMembers,
          eq(groupMembers.groupId, sql`${objectAccessGrants.subjectId}::uuid`),
        )
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(
          and(
            eq(objectAccessGrants.objectType, CONTAINER_OBJECT_TYPE),
            eq(objectAccessGrants.subjectType, "group"),
            inArray(objectAccessGrants.objectId, containerIds),
          ),
        ),
    ]);

  return [
    ...directUserRecipients,
    ...organizationRecipients,
    ...groupRecipients,
  ];
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
