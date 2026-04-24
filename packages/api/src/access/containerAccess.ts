import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  containers,
  objectAccessEpochs,
  objectAccessGrants,
  users,
} from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "./accessFingerprint";
import {
  mergeReferencedPrincipals,
  toReferencedPrincipalState,
} from "./principalReferences";
import {
  getCurrentPrincipalStates,
  listCurrentPrincipalProjectionMembers,
  type StoredPrincipalState,
} from "./principalStateStore";
import {
  type AccessLevel,
  type EffectivePrincipalRecipient,
  isUserPrincipalRecipient,
  principalRecipientKey,
  toEffectivePrincipalRecipient,
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

interface DirectUserGrantRecipientRow {
  userId: string;
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

type ProjectionMember = Awaited<
  ReturnType<typeof listCurrentPrincipalProjectionMembers>
>[number];

interface GrantResolutionContext {
  currentPrincipalStatePromisesByType: Map<
    ManagedRecipientPrincipalType,
    Map<string, Promise<StoredPrincipalState>>
  >;
  currentPrincipalStatesByType: Map<
    ManagedRecipientPrincipalType,
    Map<string, StoredPrincipalState>
  >;
  directUserGrantRecipientsById: Map<string, DirectUserGrantRecipientRow>;
  managedPrincipalExpansionPromisesByKey: Map<
    string,
    Promise<ManagedPrincipalExpansion>
  >;
  managedPrincipalExpansionsByKey: Map<string, ManagedPrincipalExpansion>;
  projectionMemberPromisesByPrincipalKey: Map<
    string,
    Promise<ProjectionMember[]>
  >;
  projectionMembersByPrincipalKey: Map<string, ProjectionMember[]>;
}

interface ManagedPrincipalExpansion {
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  userRecipients: DirectUserGrantRecipientRow[];
}

interface DirectResolvedGrantInputs {
  effectiveRecipients: EffectiveContainerRecipient[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}

export class ContainerCryptoRecipientResolutionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "ContainerCryptoRecipientResolutionError";
  }
}

function isAccessLevel(value: string): value is AccessLevel {
  return value === "read" || value === "write" || value === "admin";
}

function isManagedPrincipalType(
  value: string,
): value is ManagedRecipientPrincipalType {
  return value === "group" || value === "organization";
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

function missingDirectUserRecipientMessage(userId: string): string {
  return `Missing direct user recipient key for user:${userId}`;
}

function missingManagedPrincipalStateMessage(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): string {
  return `Missing current principal policy state for ${principalType}:${principalId}`;
}

function membershipCycleMessage(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): string {
  return `Principal membership cycle detected for ${principalType}:${principalId}`;
}

function managedPrincipalKey(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): string {
  return `${principalType}:${principalId}`;
}

function referencedPrincipalKey(
  principal: Pick<
    ReferencedPrincipalStateResponse,
    "principalType" | "principalId"
  >,
): string {
  return `${principal.principalType}:${principal.principalId}`;
}

function sortReferencedPrincipalStates(
  principals: ReferencedPrincipalStateResponse[],
): ReferencedPrincipalStateResponse[] {
  return principals.sort((left, right) => {
    if (left.principalType !== right.principalType) {
      return left.principalType.localeCompare(right.principalType);
    }

    return left.principalId.localeCompare(right.principalId);
  });
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

async function ensureDirectUserGrantRecipients(
  userIds: ReadonlyArray<string>,
  context: GrantResolutionContext,
  executor: ContainerAccessExecutor = db,
): Promise<void> {
  const missingUserIds = uniqueSortedStrings(
    userIds.filter(
      (userId) => !context.directUserGrantRecipientsById.has(userId),
    ),
  );

  if (missingUserIds.length === 0) {
    return;
  }

  const loadedRecipients = await loadDirectUserGrantRecipients(
    missingUserIds,
    executor,
  );

  for (const [userId, recipient] of loadedRecipients) {
    context.directUserGrantRecipientsById.set(userId, recipient);
  }
}

async function getOrLoadCurrentManagedPrincipalState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  context: GrantResolutionContext,
  executor: ContainerAccessExecutor = db,
): Promise<StoredPrincipalState> {
  const cachedState = context.currentPrincipalStatesByType
    .get(principalType)
    ?.get(principalId);

  if (cachedState) {
    return cachedState;
  }

  let promiseById =
    context.currentPrincipalStatePromisesByType.get(principalType);
  if (!promiseById) {
    promiseById = new Map();
    context.currentPrincipalStatePromisesByType.set(principalType, promiseById);
  }

  const cachedPromise = promiseById.get(principalId);
  if (cachedPromise) {
    return cachedPromise;
  }

  const loadPromise = (async () => {
    const loadedStates = await getCurrentPrincipalStates(
      principalType,
      [principalId],
      executor,
    );
    const loadedState = loadedStates.get(principalId);

    if (!loadedState) {
      throw new ContainerCryptoRecipientResolutionError(
        missingManagedPrincipalStateMessage(principalType, principalId),
      );
    }

    let statesById = context.currentPrincipalStatesByType.get(principalType);
    if (!statesById) {
      statesById = new Map();
      context.currentPrincipalStatesByType.set(principalType, statesById);
    }
    statesById.set(principalId, loadedState);

    return loadedState;
  })();

  promiseById.set(principalId, loadPromise);

  try {
    return await loadPromise;
  } finally {
    promiseById.delete(principalId);
  }
}

async function listOrLoadProjectionMembers(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  context: GrantResolutionContext,
  executor: ContainerAccessExecutor = db,
): Promise<ProjectionMember[]> {
  const principalKey = managedPrincipalKey(principalType, principalId);
  const cachedMembers =
    context.projectionMembersByPrincipalKey.get(principalKey);

  if (cachedMembers) {
    return cachedMembers;
  }

  const cachedPromise =
    context.projectionMemberPromisesByPrincipalKey.get(principalKey);

  if (cachedPromise) {
    return cachedPromise;
  }

  const loadPromise = (async () => {
    const loadedMembers = await listCurrentPrincipalProjectionMembers(
      principalType,
      principalId,
      executor,
    );

    context.projectionMembersByPrincipalKey.set(principalKey, loadedMembers);

    return loadedMembers;
  })();

  context.projectionMemberPromisesByPrincipalKey.set(principalKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    context.projectionMemberPromisesByPrincipalKey.delete(principalKey);
  }
}

async function createGrantResolutionContext(
  grants: ReadonlyArray<ContainerGrantRow>,
  executor: ContainerAccessExecutor = db,
): Promise<GrantResolutionContext> {
  const directUserGrantRecipientsById = await loadDirectUserGrantRecipients(
    grants
      .filter((grant) => grant.subjectType === "user")
      .map((grant) => grant.subjectId),
    executor,
  );
  const currentPrincipalStatesByType = new Map<
    ManagedRecipientPrincipalType,
    Map<string, StoredPrincipalState>
  >([
    ["group", new Map()],
    ["organization", new Map()],
  ]);

  for (const principalType of ["group", "organization"] as const) {
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      uniqueSortedStrings(
        grants
          .filter((grant) => grant.subjectType === principalType)
          .map((grant) => grant.subjectId),
      ),
      executor,
    );

    currentPrincipalStatesByType.set(principalType, new Map(currentStates));
  }

  return {
    currentPrincipalStatePromisesByType: new Map([
      ["group", new Map()],
      ["organization", new Map()],
    ]),
    currentPrincipalStatesByType,
    directUserGrantRecipientsById,
    managedPrincipalExpansionPromisesByKey: new Map(),
    managedPrincipalExpansionsByKey: new Map(),
    projectionMemberPromisesByPrincipalKey: new Map(),
    projectionMembersByPrincipalKey: new Map(),
  };
}

async function buildManagedPrincipalExpansion(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  principalKey: string,
  context: GrantResolutionContext,
  executor: ContainerAccessExecutor,
  trail: ReadonlySet<string>,
): Promise<ManagedPrincipalExpansion> {
  const currentState = await getOrLoadCurrentManagedPrincipalState(
    principalType,
    principalId,
    context,
    executor,
  );
  const projectionMembers = await listOrLoadProjectionMembers(
    principalType,
    principalId,
    context,
    executor,
  );
  const nestedTrail = new Set(trail);
  nestedTrail.add(principalKey);
  const nestedReferencedPrincipals = new Map<
    string,
    ReferencedPrincipalStateResponse
  >([[principalKey, toReferencedPrincipalState(currentState)]]);
  const memberUserIds = new Set<string>();
  const nestedExpansions = await Promise.all(
    projectionMembers.map(async (member) => {
      if (member.memberPrincipalType === "user") {
        memberUserIds.add(member.memberPrincipalId);
        return null;
      }

      return expandManagedPrincipal(
        member.memberPrincipalType,
        member.memberPrincipalId,
        context,
        executor,
        nestedTrail,
      );
    }),
  );

  for (const nestedExpansion of nestedExpansions) {
    if (!nestedExpansion) {
      continue;
    }

    for (const recipient of nestedExpansion.userRecipients) {
      memberUserIds.add(recipient.userId);
    }

    for (const referencedPrincipal of nestedExpansion.referencedPrincipals) {
      nestedReferencedPrincipals.set(
        referencedPrincipalKey(referencedPrincipal),
        referencedPrincipal,
      );
    }
  }

  await ensureDirectUserGrantRecipients(
    Array.from(memberUserIds),
    context,
    executor,
  );

  return {
    referencedPrincipals: sortReferencedPrincipalStates(
      Array.from(nestedReferencedPrincipals.values()),
    ),
    userRecipients: uniqueSortedStrings(Array.from(memberUserIds)).map(
      (userId) => {
        const recipient = context.directUserGrantRecipientsById.get(userId);

        if (!recipient) {
          throw new ContainerCryptoRecipientResolutionError(
            missingDirectUserRecipientMessage(userId),
          );
        }

        return recipient;
      },
    ),
  };
}

async function expandManagedPrincipal(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  context: GrantResolutionContext,
  executor: ContainerAccessExecutor = db,
  trail: ReadonlySet<string> = new Set(),
): Promise<ManagedPrincipalExpansion> {
  const principalKey = managedPrincipalKey(principalType, principalId);

  if (trail.has(principalKey)) {
    throw new ContainerCryptoRecipientResolutionError(
      membershipCycleMessage(principalType, principalId),
    );
  }

  const cachedExpansion =
    context.managedPrincipalExpansionsByKey.get(principalKey);
  if (cachedExpansion) {
    return cachedExpansion;
  }

  const cachedPromise =
    context.managedPrincipalExpansionPromisesByKey.get(principalKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const expansionPromise = buildManagedPrincipalExpansion(
    principalType,
    principalId,
    principalKey,
    context,
    executor,
    trail,
  );

  context.managedPrincipalExpansionPromisesByKey.set(
    principalKey,
    expansionPromise,
  );

  try {
    const expansion = await expansionPromise;
    context.managedPrincipalExpansionsByKey.set(principalKey, expansion);
    return expansion;
  } finally {
    context.managedPrincipalExpansionPromisesByKey.delete(principalKey);
  }
}

async function resolveGrantedRecipientsByObjectId(
  grants: ReadonlyArray<ContainerGrantRow>,
  context: GrantResolutionContext,
  executor: ContainerAccessExecutor = db,
): Promise<{
  grantedRecipients: GrantedRecipientWithObjectIdRow[];
  referencedPrincipalsByObjectId: Map<
    string,
    ReferencedPrincipalStateResponse[]
  >;
}> {
  const grantedRecipients: GrantedRecipientWithObjectIdRow[] = [];
  const referencedPrincipalsByObjectId = new Map<
    string,
    Map<string, ReferencedPrincipalStateResponse>
  >();
  const resolvedGrants = await Promise.all(
    grants.map((grant) =>
      resolveGrantedRecipientsForGrant(grant, context, executor),
    ),
  );

  for (const resolvedGrant of resolvedGrants) {
    if (!resolvedGrant) {
      continue;
    }

    grantedRecipients.push(...resolvedGrant.grantedRecipients);

    const referencesForObject =
      referencedPrincipalsByObjectId.get(resolvedGrant.grant.objectId) ??
      new Map();
    for (const referencedPrincipal of resolvedGrant.referencedPrincipals) {
      referencesForObject.set(
        referencedPrincipalKey(referencedPrincipal),
        referencedPrincipal,
      );
    }
    referencedPrincipalsByObjectId.set(
      resolvedGrant.grant.objectId,
      referencesForObject,
    );
  }

  return {
    grantedRecipients,
    referencedPrincipalsByObjectId: new Map(
      Array.from(referencedPrincipalsByObjectId.entries()).map(
        ([objectId, referencedPrincipals]) => [
          objectId,
          sortReferencedPrincipalStates(
            Array.from(referencedPrincipals.values()),
          ),
        ],
      ),
    ),
  };
}

async function resolveGrantedRecipientsForGrant(
  grant: ContainerGrantRow,
  context: GrantResolutionContext,
  executor: ContainerAccessExecutor,
): Promise<{
  grant: ContainerGrantRow;
  grantedRecipients: GrantedRecipientWithObjectIdRow[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
} | null> {
  if (!isAccessLevel(grant.accessLevel)) {
    return null;
  }

  if (grant.subjectType === "user") {
    const recipient = context.directUserGrantRecipientsById.get(
      grant.subjectId,
    );

    if (!recipient) {
      throw new ContainerCryptoRecipientResolutionError(
        missingDirectUserRecipientMessage(grant.subjectId),
      );
    }

    return {
      grant,
      grantedRecipients: [
        {
          objectId: grant.objectId,
          userId: recipient.userId,
          accessLevel: grant.accessLevel,
          encapsulationPublicKey: recipient.encapsulationPublicKey,
          encapsulationKeyFingerprint: recipient.encapsulationKeyFingerprint,
        },
      ],
      referencedPrincipals: [],
    };
  }

  if (!isManagedPrincipalType(grant.subjectType)) {
    throw new ContainerCryptoRecipientResolutionError(
      `Unsupported container grant subject type ${grant.subjectType}`,
    );
  }

  const expansion = await expandManagedPrincipal(
    grant.subjectType,
    grant.subjectId,
    context,
    executor,
  );

  return {
    grant,
    grantedRecipients: expansion.userRecipients.map((recipient) => ({
      objectId: grant.objectId,
      userId: recipient.userId,
      accessLevel: grant.accessLevel,
      encapsulationPublicKey: recipient.encapsulationPublicKey,
      encapsulationKeyFingerprint: recipient.encapsulationKeyFingerprint,
    })),
    referencedPrincipals: expansion.referencedPrincipals,
  };
}

function upsertCryptoRecipient(
  recipientsByPrincipalKey: Map<string, EffectiveContainerRecipient>,
  nextRecipient: EffectiveContainerRecipient,
): void {
  const principalKey = principalRecipientKey(nextRecipient);
  const existingRecipient = recipientsByPrincipalKey.get(principalKey);

  recipientsByPrincipalKey.set(principalKey, {
    ...nextRecipient,
    accessLevel: mergeAccessLevel(
      existingRecipient?.accessLevel,
      nextRecipient.accessLevel,
    ),
  });
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

async function loadDirectUserGrantRecipients(
  userIds: string[],
  executor: ContainerAccessExecutor = db,
): Promise<Map<string, DirectUserGrantRecipientRow>> {
  const uniqueUserIds = uniqueSortedStrings(userIds);

  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      userId: users.id,
      encapsulationPublicKey: users.encapsulationPublicKey,
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
    })
    .from(users)
    .where(inArray(users.id, uniqueUserIds));

  return new Map(
    rows.map((row) => [
      row.userId,
      {
        userId: row.userId,
        encapsulationPublicKey: row.encapsulationPublicKey,
        encapsulationKeyFingerprint: row.encapsulationKeyFingerprint,
      },
    ]),
  );
}

function buildCryptoRecipientsFromGrantRows(
  grants: ReadonlyArray<ContainerGrantRow>,
  context: GrantResolutionContext,
): EffectiveContainerRecipient[] {
  const recipientsByPrincipalKey = new Map<
    string,
    EffectiveContainerRecipient
  >();

  for (const grant of grants) {
    if (!isAccessLevel(grant.accessLevel)) {
      continue;
    }

    if (grant.subjectType === "user") {
      const userRecipient = context.directUserGrantRecipientsById.get(
        grant.subjectId,
      );

      if (!userRecipient) {
        throw new ContainerCryptoRecipientResolutionError(
          missingDirectUserRecipientMessage(grant.subjectId),
        );
      }

      const nextRecipient = toEffectiveUserPrincipalRecipient({
        userId: grant.subjectId,
        accessLevel: grant.accessLevel,
        encapsulationPublicKey: userRecipient.encapsulationPublicKey,
        keyFingerprint: userRecipient.encapsulationKeyFingerprint,
      });
      upsertCryptoRecipient(recipientsByPrincipalKey, nextRecipient);
      continue;
    }

    if (!isManagedPrincipalType(grant.subjectType)) {
      throw new ContainerCryptoRecipientResolutionError(
        `Unsupported container grant subject type ${grant.subjectType}`,
      );
    }

    const currentPrincipalState = context.currentPrincipalStatesByType
      .get(grant.subjectType)
      ?.get(grant.subjectId);

    if (!currentPrincipalState) {
      throw new ContainerCryptoRecipientResolutionError(
        missingManagedPrincipalStateMessage(grant.subjectType, grant.subjectId),
      );
    }

    const nextRecipient = toEffectivePrincipalRecipient({
      principalType: currentPrincipalState.principalType,
      principalId: currentPrincipalState.principalId,
      accessLevel: grant.accessLevel,
      encapsulationPublicKey: currentPrincipalState.encapsulationPublicKey,
      keyFingerprint: currentPrincipalState.keyFingerprint,
    });
    upsertCryptoRecipient(recipientsByPrincipalKey, nextRecipient);
  }

  return Array.from(recipientsByPrincipalKey.values()).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
}

async function resolveContainerRecipients(
  containerId: string,
  executor: ContainerAccessExecutor = db,
  grantResolutionContext?: GrantResolutionContext,
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
  const context =
    grantResolutionContext ??
    (await createGrantResolutionContext(grants, executor));
  const { grantedRecipients, referencedPrincipalsByObjectId } =
    await resolveGrantedRecipientsByObjectId(grants, context, executor);
  const effectiveRecipients =
    buildEffectiveRecipientsFromGrantedRecipients(grantedRecipients);
  const referencedPrincipals = mergeReferencedPrincipalStateArrays(
    ...Array.from(referencedPrincipalsByObjectId.values()),
  );

  return {
    ancestorContainerIds,
    referencedPrincipals,
    effectiveRecipients,
    cryptoRecipients: buildCryptoRecipientsFromGrantRows(grants, context),
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
  const grantResolutionContext = await createGrantResolutionContext(
    [...rootAncestorGrants, ...directGrants],
    input.executor,
  );

  return {
    directGrantsByContainerId,
    directResolvedInputsByContainerId: groupDirectResolvedInputsByObjectId(
      await resolveGrantedRecipientsByObjectId(
        directGrants,
        grantResolutionContext,
        input.executor,
      ),
    ),
    grantResolutionContext,
    rootResolvedInputs: await resolveContainerRecipients(
      input.containerId,
      input.executor,
      grantResolutionContext,
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
    grantResolutionContext,
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
    const cryptoRecipients = buildCryptoRecipientsFromGrantRows(
      resolvedInputs.grants,
      grantResolutionContext,
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
