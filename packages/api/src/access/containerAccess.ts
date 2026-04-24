import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { containers, objectAccessEpochs, objectAccessGrants } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "./accessFingerprint";
import {
  ContainerCryptoRecipientResolutionError,
  type AccessGrantRow as ContainerGrantRow,
  type GrantedRecipientWithObjectIdRow,
  PrincipalGrantResolver,
} from "./principalGrantResolver";
import { mergeReferencedPrincipals } from "./principalReferences";
import {
  type AccessLevel,
  type EffectivePrincipalRecipient,
  isUserPrincipalRecipient,
  principalRecipientKey,
  toEffectiveUserPrincipalRecipient,
  toPrincipalFingerprintRecipient,
} from "./recipientPrincipals";

export { ContainerCryptoRecipientResolutionError } from "./principalGrantResolver";

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

interface AncestorContainerRow {
  id: string;
  cycleDetected: boolean;
}

interface DescendantContainerRow {
  id: string;
  parentId: string | null;
  depth: number;
}

type CurrentEpochRow = {
  epoch: number;
  accessFingerprint: string;
  accessStateHash: string | null;
};

interface ContainerAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  accessStateHash: string;
  ancestorContainerIds: string[];
  grants: Array<{
    objectId: string;
    subjectType: string;
    subjectId: string;
    accessLevel: string;
  }>;
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  effectiveRecipients: EffectiveContainerRecipient[];
  cryptoRecipients: EffectiveContainerRecipient[];
}

interface DirectResolvedGrantInputs {
  effectiveRecipients: EffectiveContainerRecipient[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
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

function mergeReferencedPrincipalStateArrays(
  ...principalSets: ReadonlyArray<ReferencedPrincipalStateResponse>[]
): ReferencedPrincipalStateResponse[] {
  return mergeReferencedPrincipals(
    principalSets.map((referencedPrincipals) => ({
      referencedPrincipals: [...referencedPrincipals],
    })),
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
      accessStateHash: objectAccessEpochs.accessStateHash,
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
      accessStateHash: objectAccessEpochs.accessStateHash,
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
      accessStateHash: row.accessStateHash,
    });
  }

  return currentEpochByContainerId;
}

export async function listDescendantContainers(
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

export async function listDescendantContainerIds(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<string[]> {
  return (await listDescendantContainers(containerId, executor)).map(
    (container) => container.id,
  );
}

async function writeEpoch(
  containerId: string,
  epoch: number,
  accessFingerprint: string,
  accessStateHash: string,
  executor: ContainerAccessExecutor = db,
) {
  await executor.insert(objectAccessEpochs).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: containerId,
    epoch,
    accessFingerprint,
    accessStateHash,
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
  const {
    ancestorContainerIds,
    cryptoRecipients,
    grants,
    referencedPrincipals,
  } = inheritedState
    ? {
        ancestorContainerIds: [
          ...inheritedState.ancestorContainerIds,
          containerId,
        ],
        cryptoRecipients: inheritedState.cryptoRecipients,
        grants: inheritedState.grants,
        referencedPrincipals: inheritedState.referencedPrincipals,
      }
    : await resolveContainerRecipients(containerId, executor);
  const accessFingerprint = await computeContainerFingerprint({
    containerId,
    ancestorContainerIds,
    grants,
    cryptoRecipients,
  });
  const accessStateHash = await computeContainerAccessStateHash({
    containerId,
    ancestorContainerIds,
    grants,
    referencedPrincipals,
  });

  const initialEpoch = 1;
  await writeEpoch(
    containerId,
    initialEpoch,
    accessFingerprint,
    accessStateHash,
    executor,
  );
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

async function resolveContainerRecipients(
  containerId: string,
  executor: ContainerAccessExecutor = db,
  grantResolver?: PrincipalGrantResolver,
): Promise<{
  ancestorContainerIds: string[];
  effectiveRecipients: EffectiveContainerRecipient[];
  cryptoRecipients: EffectiveContainerRecipient[];
  grants: ContainerGrantRow[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}> {
  const ancestorContainerIds = await listAncestorContainerIds(
    containerId,
    executor,
  );
  const grants = await loadContainerGrantRows(ancestorContainerIds, executor);
  const resolver = grantResolver ?? new PrincipalGrantResolver(executor);
  await resolver.prime(grants);
  const { grantedRecipients, referencedPrincipalsByObjectId } =
    await resolver.resolveGrantEffects(grants);
  const effectiveRecipients =
    buildEffectiveRecipientsFromGrantedRecipients(grantedRecipients);
  const referencedPrincipals = mergeReferencedPrincipalStateArrays(
    ...Array.from(referencedPrincipalsByObjectId.values()),
  );

  return {
    ancestorContainerIds,
    referencedPrincipals,
    effectiveRecipients,
    cryptoRecipients: await resolver.buildCryptoRecipients(grants),
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
  directRecipients: ReadonlyArray<EffectiveContainerRecipient>,
): EffectiveContainerRecipient[] {
  const recipientsByPrincipalKey = new Map<
    string,
    EffectiveContainerRecipient
  >();

  for (const recipient of inheritedRecipients) {
    recipientsByPrincipalKey.set(principalRecipientKey(recipient), recipient);
  }

  for (const recipient of directRecipients) {
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
  cryptoRecipients: EffectiveContainerRecipient[];
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
    recipients: input.cryptoRecipients.map(toPrincipalFingerprintRecipient),
  });
}

async function computeContainerAccessStateHash(input: {
  containerId: string;
  ancestorContainerIds: string[];
  grants: ContainerGrantRow[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}) {
  return computeAccessStateHash({
    objectType: CONTAINER_OBJECT_TYPE,
    containerId: input.containerId,
    ancestorContainerIds: input.ancestorContainerIds,
    grants: input.grants.map((grant) => ({
      objectId: grant.objectId,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      accessLevel: grant.accessLevel,
    })),
    referencedPrincipals: input.referencedPrincipals.map((principal) => ({
      principalType: principal.principalType,
      principalId: principal.principalId,
      version: principal.version,
      keyEpoch: principal.keyEpoch,
      stateHash: principal.stateHash,
    })),
  });
}

async function materializeCurrentContainerAccessState(input: {
  containerId: string;
  currentEpochRow: CurrentEpochRow;
  executor: ContainerAccessExecutor;
  resolvedRecipients: Awaited<ReturnType<typeof resolveContainerRecipients>>;
}): Promise<{
  accessFingerprint: string;
  accessStateHash: string;
  currentEpochRow: CurrentEpochRow & { accessStateHash: string };
}> {
  const accessFingerprint = await computeContainerFingerprint({
    containerId: input.containerId,
    ancestorContainerIds: input.resolvedRecipients.ancestorContainerIds,
    grants: input.resolvedRecipients.grants,
    cryptoRecipients: input.resolvedRecipients.cryptoRecipients,
  });
  const accessStateHash = await computeContainerAccessStateHash({
    containerId: input.containerId,
    ancestorContainerIds: input.resolvedRecipients.ancestorContainerIds,
    grants: input.resolvedRecipients.grants,
    referencedPrincipals: input.resolvedRecipients.referencedPrincipals,
  });

  if (
    input.currentEpochRow.accessFingerprint === accessFingerprint &&
    input.currentEpochRow.accessStateHash === accessStateHash
  ) {
    return {
      accessFingerprint,
      accessStateHash,
      currentEpochRow: {
        ...input.currentEpochRow,
        accessStateHash,
      },
    };
  }

  const nextEpoch = input.currentEpochRow.epoch + 1;
  await writeEpoch(
    input.containerId,
    nextEpoch,
    accessFingerprint,
    accessStateHash,
    input.executor,
  );

  return {
    accessFingerprint,
    accessStateHash,
    currentEpochRow: {
      epoch: nextEpoch,
      accessFingerprint,
      accessStateHash,
    },
  };
}

interface ResolvedContainerInputs {
  ancestorContainerIds: string[];
  effectiveRecipients: EffectiveContainerRecipient[];
  grants: ContainerGrantRow[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
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

function groupDirectResolvedInputsByObjectId(input: {
  grantedRecipients: GrantedRecipientWithObjectIdRow[];
  referencedPrincipalsByObjectId: Map<
    string,
    ReferencedPrincipalStateResponse[]
  >;
}): Map<string, DirectResolvedGrantInputs> {
  const grantedRecipientsByObjectId = groupGrantedRecipientsByObjectId(
    input.grantedRecipients,
  );
  const containerIds = uniqueSortedStrings([
    ...Array.from(grantedRecipientsByObjectId.keys()),
    ...Array.from(input.referencedPrincipalsByObjectId.keys()),
  ]);

  return new Map(
    containerIds.map((containerId) => [
      containerId,
      {
        effectiveRecipients: buildEffectiveRecipientsFromGrantedRecipients(
          grantedRecipientsByObjectId.get(containerId) ?? [],
        ),
        referencedPrincipals:
          input.referencedPrincipalsByObjectId.get(containerId) ?? [],
      },
    ]),
  );
}

function resolveDescendantContainerInputs(
  descendantContainer: DescendantContainerRow,
  rootContainerId: string,
  rootResolvedInputs: ResolvedContainerInputs,
  resolvedInputsByContainerId: Map<string, ResolvedContainerInputs>,
  directGrantsByContainerId: Map<string, ContainerGrantRow[]>,
  directResolvedInputsByContainerId: Map<string, DirectResolvedGrantInputs>,
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

  const directResolvedInputs = directResolvedInputsByContainerId.get(
    descendantContainer.id,
  ) ?? {
    effectiveRecipients: [],
    referencedPrincipals: [],
  };

  return {
    ancestorContainerIds: [
      ...parentResolvedInputs.ancestorContainerIds,
      descendantContainer.id,
    ],
    effectiveRecipients: mergeEffectiveRecipients(
      parentResolvedInputs.effectiveRecipients,
      directResolvedInputs.effectiveRecipients,
    ),
    grants: [
      ...parentResolvedInputs.grants,
      ...(directGrantsByContainerId.get(descendantContainer.id) ?? []),
    ],
    referencedPrincipals: mergeReferencedPrincipalStateArrays(
      parentResolvedInputs.referencedPrincipals,
      directResolvedInputs.referencedPrincipals,
    ),
  };
}

async function prepareRefreshContainerAccessSubtree(input: {
  containerId: string;
  descendantIds: string[];
  executor: ContainerAccessExecutor;
}) {
  const directGrants = await loadContainerGrantRows(
    input.descendantIds,
    input.executor,
  );
  const directGrantsByContainerId =
    groupContainerGrantsByObjectId(directGrants);
  const rootAncestorContainerIds = await listAncestorContainerIds(
    input.containerId,
    input.executor,
  );
  const rootAncestorGrants = await loadContainerGrantRows(
    rootAncestorContainerIds,
    input.executor,
  );
  const grantResolver = new PrincipalGrantResolver(input.executor);
  await grantResolver.prime([...rootAncestorGrants, ...directGrants]);
  const directGrantEffects =
    await grantResolver.resolveGrantEffects(directGrants);

  return {
    directGrantsByContainerId,
    directResolvedInputsByContainerId:
      groupDirectResolvedInputsByObjectId(directGrantEffects),
    grantResolver,
    rootResolvedInputs: await resolveContainerRecipients(
      input.containerId,
      input.executor,
      grantResolver,
    ),
  };
}

export async function refreshContainerAccessSubtree(
  containerId: string,
  executor: ContainerAccessExecutor = db,
  options: {
    descendantContainers?: ReadonlyArray<DescendantContainerRow>;
  } = {},
): Promise<Map<string, number>> {
  const descendantContainers = options.descendantContainers
    ? [...options.descendantContainers]
    : await listDescendantContainers(containerId, executor);
  const descendantIds = descendantContainers.map((container) => container.id);
  const currentEpochByContainerId = await getCurrentEpochRows(
    descendantIds,
    executor,
  );
  const epochByContainerId = new Map<string, number>();
  const {
    directGrantsByContainerId,
    directResolvedInputsByContainerId,
    grantResolver,
    rootResolvedInputs,
  } = await prepareRefreshContainerAccessSubtree({
    containerId,
    descendantIds,
    executor,
  });
  const resolvedInputsByContainerId = new Map<
    string,
    ResolvedContainerInputs
  >();

  for (const descendantContainer of descendantContainers) {
    const currentEpochRow =
      currentEpochByContainerId.get(descendantContainer.id) ?? null;
    const resolvedInputs = resolveDescendantContainerInputs(
      descendantContainer,
      containerId,
      rootResolvedInputs,
      resolvedInputsByContainerId,
      directGrantsByContainerId,
      directResolvedInputsByContainerId,
    );
    const cryptoRecipients = await grantResolver.buildCryptoRecipients(
      resolvedInputs.grants,
    );
    const accessFingerprint = await computeContainerFingerprint({
      containerId: descendantContainer.id,
      ancestorContainerIds: resolvedInputs.ancestorContainerIds,
      grants: resolvedInputs.grants,
      cryptoRecipients,
    });
    const accessStateHash = await computeContainerAccessStateHash({
      containerId: descendantContainer.id,
      ancestorContainerIds: resolvedInputs.ancestorContainerIds,
      grants: resolvedInputs.grants,
      referencedPrincipals: resolvedInputs.referencedPrincipals,
    });

    resolvedInputsByContainerId.set(descendantContainer.id, resolvedInputs);

    if (
      currentEpochRow &&
      currentEpochRow.accessFingerprint === accessFingerprint &&
      currentEpochRow.accessStateHash === accessStateHash
    ) {
      epochByContainerId.set(descendantContainer.id, currentEpochRow.epoch);
      continue;
    }

    const nextEpoch = currentEpochRow === null ? 1 : currentEpochRow.epoch + 1;
    await writeEpoch(
      descendantContainer.id,
      nextEpoch,
      accessFingerprint,
      accessStateHash,
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

  let resolvedRecipients: Awaited<
    ReturnType<typeof resolveContainerRecipients>
  >;

  try {
    resolvedRecipients = await resolveContainerRecipients(
      containerId,
      executor,
    );
  } catch (error) {
    if (error instanceof ContainerCryptoRecipientResolutionError) {
      return null;
    }

    throw error;
  }

  const {
    ancestorContainerIds,
    effectiveRecipients,
    cryptoRecipients,
    grants,
    referencedPrincipals,
  } = resolvedRecipients;
  const {
    accessFingerprint,
    accessStateHash,
    currentEpochRow: materializedEpochRow,
  } = await materializeCurrentContainerAccessState({
    containerId,
    currentEpochRow,
    executor,
    resolvedRecipients,
  });

  return {
    currentAccessEpoch: materializedEpochRow.epoch,
    accessFingerprint,
    accessStateHash,
    ancestorContainerIds,
    grants,
    referencedPrincipals,
    effectiveRecipients,
    cryptoRecipients,
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
