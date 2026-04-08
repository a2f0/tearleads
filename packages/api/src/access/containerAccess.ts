import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { containers, objectAccessEpochs, objectAccessGrants } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import { computeAccessFingerprint } from "./accessFingerprint";
import { listReferencedPrincipalStatesForGrants } from "./principalReferences";
import {
  type AccessLevel,
  type EffectivePrincipalRecipient,
  isUserPrincipalRecipient,
  principalRecipientKey,
  toEffectiveUserPrincipalRecipient,
  toPrincipalFingerprintRecipient,
} from "./recipientPrincipals";

const CONTAINER_OBJECT_TYPE = "container";
const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

type SubjectType = "user" | "group" | "organization";
type ContainerAccessExecutor = DatabaseExecutor;

type EffectiveContainerRecipient = EffectivePrincipalRecipient;

interface GrantedRecipientRow {
  userId: string;
  accessLevel: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
}

interface GrantedRecipientWithObjectIdRow extends GrantedRecipientRow {
  objectId: string;
}

interface AncestorContainerRow {
  id: string;
  cycleDetected: boolean;
}

interface DescendantContainerRow {
  id: string;
  parentId: string | null;
  depth: number;
}

type ContainerGrantRow = {
  objectId: string;
  subjectType: string;
  subjectId: string;
  accessLevel: string;
};

type CurrentEpochRow = {
  epoch: number;
  accessFingerprint: string;
};

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
  referencedPrincipals: ReferencedPrincipalStateResponse[];
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

function isGrantedRecipientWithObjectIdRow(
  value: unknown,
): value is GrantedRecipientWithObjectIdRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "objectId") === "string" &&
    isGrantedRecipientRow(value)
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
    (typeof Reflect.get(value, "parentId") === "string" ||
      Reflect.get(value, "parentId") === null) &&
    typeof Reflect.get(value, "depth") === "number"
  );
}

async function getCurrentEpochRow(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<CurrentEpochRow | null> {
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

async function getCurrentEpochRows(
  containerIds: string[],
  executor: ContainerAccessExecutor = db,
): Promise<Map<string, CurrentEpochRow>> {
  const uniqueContainerIds = uniqueSortedStrings(containerIds);

  if (uniqueContainerIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      containerId: objectAccessEpochs.objectId,
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, CONTAINER_OBJECT_TYPE),
        inArray(objectAccessEpochs.objectId, uniqueContainerIds),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch));

  const currentEpochByContainerId = new Map<string, CurrentEpochRow>();

  for (const row of rows) {
    if (currentEpochByContainerId.has(row.containerId)) {
      continue;
    }

    currentEpochByContainerId.set(row.containerId, {
      epoch: row.epoch,
      accessFingerprint: row.accessFingerprint,
    });
  }

  return currentEpochByContainerId;
}

async function listDescendantContainers(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<DescendantContainerRow[]> {
  const result = await executor.execute(sql`
    with recursive descendants as (
      select
        c.id,
        c.parent_id,
        0 as depth
      from ${containers} c
      where c.id = ${containerId}
      union all
      select
        child.id,
        child.parent_id,
        descendants.depth + 1 as depth
      from ${containers} child
      inner join descendants on child.parent_id = descendants.id
      where descendants.depth < 100
    )
    select
      id::text as "id",
      parent_id::text as "parentId",
      depth as "depth"
    from descendants
    order by depth asc, id asc
  `);

  const descendantContainers: DescendantContainerRow[] = [];

  for (const row of result.rows) {
    if (!isDescendantContainerRow(row)) {
      throw new Error("Unexpected row shape from descendants CTE");
    }

    descendantContainers.push(row);
  }

  return descendantContainers;
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
): Promise<ContainerGrantRow[]> {
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

async function loadGrantedRecipientsByObjectId(
  containerIds: string[],
  executor: ContainerAccessExecutor = db,
): Promise<GrantedRecipientWithObjectIdRow[]> {
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
      g.object_id as "objectId",
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
      g.object_id as "objectId",
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
      g.object_id as "objectId",
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

  const grantedRecipients: GrantedRecipientWithObjectIdRow[] = [];

  for (const row of result.rows) {
    if (!isGrantedRecipientWithObjectIdRow(row)) {
      continue;
    }

    grantedRecipients.push({
      objectId: Reflect.get(row, "objectId"),
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

async function loadGrantedRecipients(
  containerIds: string[],
  executor: ContainerAccessExecutor = db,
) {
  const grantedRecipients = await loadGrantedRecipientsByObjectId(
    containerIds,
    executor,
  );

  return grantedRecipients.map((row) => ({
    userId: row.userId,
    accessLevel: row.accessLevel,
    encapsulationPublicKey: row.encapsulationPublicKey,
    encapsulationKeyFingerprint: row.encapsulationKeyFingerprint,
  }));
}

async function resolveContainerRecipients(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<{
  ancestorContainerIds: string[];
  effectiveRecipients: EffectiveContainerRecipient[];
  grants: ContainerGrantRow[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
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

  return {
    ancestorContainerIds,
    referencedPrincipals: await listReferencedPrincipalStatesForGrants(
      grants.map((grant) => ({
        principalId: grant.subjectId,
        principalType: grant.subjectType,
      })),
      executor,
    ),
    effectiveRecipients:
      buildEffectiveRecipientsFromGrantedRecipients(grantedRecipients),
    grants,
  };
}

function buildEffectiveRecipientsFromGrantedRecipients(
  grantedRecipients: ReadonlyArray<GrantedRecipientRow>,
): EffectiveContainerRecipient[] {
  const recipientsByPrincipalKey = new Map<
    string,
    EffectiveContainerRecipient
  >();

  for (const recipient of grantedRecipients) {
    if (
      !isAccessLevel(recipient.accessLevel) ||
      recipient.encapsulationPublicKey.length === 0 ||
      recipient.encapsulationKeyFingerprint.length === 0
    ) {
      continue;
    }

    const nextRecipient = toEffectiveUserPrincipalRecipient({
      userId: recipient.userId,
      accessLevel: recipient.accessLevel,
      encapsulationPublicKey: recipient.encapsulationPublicKey,
      keyFingerprint: recipient.encapsulationKeyFingerprint,
    });
    const principalKey = principalRecipientKey(nextRecipient);
    const existingRecipient = recipientsByPrincipalKey.get(principalKey);

    recipientsByPrincipalKey.set(principalKey, {
      ...nextRecipient,
      accessLevel: existingRecipient
        ? mergeAccessLevel(
            existingRecipient.accessLevel,
            nextRecipient.accessLevel,
          )
        : nextRecipient.accessLevel,
    });
  }

  const effectiveRecipients = Array.from(recipientsByPrincipalKey.values());

  effectiveRecipients.sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return effectiveRecipients;
}

function mergeEffectiveRecipients(
  inheritedRecipients: ReadonlyArray<EffectiveContainerRecipient>,
  directGrantedRecipients: ReadonlyArray<GrantedRecipientRow>,
): EffectiveContainerRecipient[] {
  const recipientsByPrincipalKey = new Map<
    string,
    EffectiveContainerRecipient
  >();

  for (const recipient of inheritedRecipients) {
    recipientsByPrincipalKey.set(principalRecipientKey(recipient), recipient);
  }

  for (const recipient of buildEffectiveRecipientsFromGrantedRecipients(
    directGrantedRecipients,
  )) {
    const principalKey = principalRecipientKey(recipient);
    const existingRecipient = recipientsByPrincipalKey.get(principalKey);

    recipientsByPrincipalKey.set(principalKey, {
      principalType: recipient.principalType,
      principalId: recipient.principalId,
      accessLevel: existingRecipient
        ? mergeAccessLevel(existingRecipient.accessLevel, recipient.accessLevel)
        : recipient.accessLevel,
      encapsulationPublicKey: recipient.encapsulationPublicKey,
      keyFingerprint: recipient.keyFingerprint,
    });
  }

  return Array.from(recipientsByPrincipalKey.values()).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
}

async function computeContainerFingerprint(input: {
  containerId: string;
  ancestorContainerIds: string[];
  grants: ContainerGrantRow[];
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
    recipients: input.effectiveRecipients.map(toPrincipalFingerprintRecipient),
  });
}

interface ResolvedContainerInputs {
  ancestorContainerIds: string[];
  effectiveRecipients: EffectiveContainerRecipient[];
  grants: ContainerGrantRow[];
}

function groupContainerGrantsByObjectId(grants: ContainerGrantRow[]) {
  const directGrantsByContainerId = new Map<string, ContainerGrantRow[]>();

  for (const grant of grants) {
    const nextGrants = directGrantsByContainerId.get(grant.objectId) ?? [];
    nextGrants.push(grant);
    directGrantsByContainerId.set(grant.objectId, nextGrants);
  }

  return directGrantsByContainerId;
}

function groupGrantedRecipientsByObjectId(
  recipients: GrantedRecipientWithObjectIdRow[],
) {
  const directGrantedRecipientsByContainerId = new Map<
    string,
    GrantedRecipientRow[]
  >();

  for (const recipient of recipients) {
    const nextRecipients =
      directGrantedRecipientsByContainerId.get(recipient.objectId) ?? [];
    const nextRecipient = {
      userId: recipient.userId,
      accessLevel: recipient.accessLevel,
      encapsulationPublicKey: recipient.encapsulationPublicKey,
      encapsulationKeyFingerprint: recipient.encapsulationKeyFingerprint,
    };
    nextRecipients.push(nextRecipient);
    directGrantedRecipientsByContainerId.set(
      recipient.objectId,
      nextRecipients,
    );
  }

  return directGrantedRecipientsByContainerId;
}

function resolveDescendantContainerInputs(
  descendantContainer: DescendantContainerRow,
  rootContainerId: string,
  rootResolvedInputs: ResolvedContainerInputs,
  resolvedInputsByContainerId: Map<string, ResolvedContainerInputs>,
  directGrantsByContainerId: Map<string, ContainerGrantRow[]>,
  directGrantedRecipientsByContainerId: Map<string, GrantedRecipientRow[]>,
): ResolvedContainerInputs {
  if (descendantContainer.id === rootContainerId) {
    return rootResolvedInputs;
  }

  const parentId = descendantContainer.parentId;
  if (!parentId) {
    throw new Error(
      `Descendant container ${descendantContainer.id} is missing parent`,
    );
  }

  const parentResolvedInputs = resolvedInputsByContainerId.get(parentId);
  if (!parentResolvedInputs) {
    throw new Error(
      `Parent container ${parentId} was not resolved before child ${descendantContainer.id}`,
    );
  }

  return {
    ancestorContainerIds: [
      ...parentResolvedInputs.ancestorContainerIds,
      descendantContainer.id,
    ],
    effectiveRecipients: mergeEffectiveRecipients(
      parentResolvedInputs.effectiveRecipients,
      directGrantedRecipientsByContainerId.get(descendantContainer.id) ?? [],
    ),
    grants: [
      ...parentResolvedInputs.grants,
      ...(directGrantsByContainerId.get(descendantContainer.id) ?? []),
    ],
  };
}

async function refreshContainerAccessSubtree(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<Map<string, number>> {
  const descendantContainers = await listDescendantContainers(
    containerId,
    executor,
  );
  const descendantIds = descendantContainers.map((container) => container.id);
  const currentEpochByContainerId = await getCurrentEpochRows(
    descendantIds,
    executor,
  );
  const directGrants = await loadContainerGrantRows(descendantIds, executor);
  const directGrantedRecipients = await loadGrantedRecipientsByObjectId(
    descendantIds,
    executor,
  );
  const epochByContainerId = new Map<string, number>();
  const directGrantsByContainerId =
    groupContainerGrantsByObjectId(directGrants);
  const directGrantedRecipientsByContainerId = groupGrantedRecipientsByObjectId(
    directGrantedRecipients,
  );
  const resolvedInputsByContainerId = new Map<
    string,
    ResolvedContainerInputs
  >();
  const rootResolvedInputs = await resolveContainerRecipients(
    containerId,
    executor,
  );

  for (const descendantContainer of descendantContainers) {
    const currentEpochRow =
      currentEpochByContainerId.get(descendantContainer.id) ?? null;
    const resolvedInputs = resolveDescendantContainerInputs(
      descendantContainer,
      containerId,
      rootResolvedInputs,
      resolvedInputsByContainerId,
      directGrantsByContainerId,
      directGrantedRecipientsByContainerId,
    );
    const accessFingerprint = await computeContainerFingerprint({
      containerId: descendantContainer.id,
      ancestorContainerIds: resolvedInputs.ancestorContainerIds,
      grants: resolvedInputs.grants,
      effectiveRecipients: resolvedInputs.effectiveRecipients,
    });

    resolvedInputsByContainerId.set(descendantContainer.id, resolvedInputs);

    if (
      currentEpochRow &&
      currentEpochRow.accessFingerprint === accessFingerprint
    ) {
      epochByContainerId.set(descendantContainer.id, currentEpochRow.epoch);
      continue;
    }

    const nextEpoch = currentEpochRow === null ? 1 : currentEpochRow.epoch + 1;
    await writeEpoch(
      descendantContainer.id,
      nextEpoch,
      accessFingerprint,
      executor,
    );
    epochByContainerId.set(descendantContainer.id, nextEpoch);
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

  const {
    ancestorContainerIds,
    effectiveRecipients,
    grants,
    referencedPrincipals,
  } = await resolveContainerRecipients(containerId, executor);
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
    referencedPrincipals,
    effectiveRecipients,
  };
}

export function canReadContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some((recipient) =>
    isUserPrincipalRecipient(recipient, userId),
  );
}

export function canWriteContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      isUserPrincipalRecipient(recipient, userId) &&
      accessLevelRank(recipient.accessLevel) >= accessLevelRank("write"),
  );
}

export function canAdminContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      isUserPrincipalRecipient(recipient, userId) &&
      recipient.accessLevel === "admin",
  );
}
