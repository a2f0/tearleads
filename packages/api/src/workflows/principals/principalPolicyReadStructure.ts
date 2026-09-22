import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  containers,
  groups,
  organizations,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalStates,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { uniqueSortedStrings } from "../../utils/array";

/**
 * Structural inputs to the principal policy read authorization: which
 * containers the requester holds grants on, which containers reference the
 * principal, and how those meet in the container tree. Nothing here verifies
 * a manifest; `principalPolicyReadAuthorization.ts` verifies the candidates
 * this module selects.
 */

/** Longer chains than this are not valid container paths. */
const MAX_ANCESTOR_WALK_DEPTH = 64;
/** Keep `IN (...)` lists well under the bound-parameter limit. */
const ID_BATCH_SIZE = 400;

function batches(values: ReadonlyArray<string>): string[][] {
  const unique = uniqueSortedStrings(values);
  const result: string[][] = [];
  for (let index = 0; index < unique.length; index += ID_BATCH_SIZE) {
    result.push(unique.slice(index, index + ID_BATCH_SIZE));
  }
  return result;
}

/** Groups whose CURRENT projection names the user; superseded states do not count. */
async function listCurrentGroupIdsForUser(
  executor: DatabaseSession,
  userId: string,
): Promise<string[]> {
  const rows = await executor
    .select({
      principalId: principalMembershipProjection.principalId,
      stateHash: principalMembershipProjection.stateHash,
    })
    .from(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, "group"),
        eq(principalMembershipProjection.userId, userId),
      ),
    );
  const current: string[] = [];
  for (const batch of batches(rows.map((row) => row.principalId))) {
    const currentStates = await getCurrentPrincipalStates(
      "group",
      batch,
      executor,
    );
    current.push(
      ...rows
        .filter(
          (row) =>
            currentStates.get(row.principalId)?.stateHash === row.stateHash,
        )
        .map((row) => row.principalId),
    );
  }
  return uniqueSortedStrings(current);
}

/** Join a grant or cited-head projection row to the container's CURRENT head. */
function currentContainerHeadJoin(projection: {
  readonly containerId: typeof accessManifestContainerGrantProjection.containerId;
  readonly manifestHash: typeof accessManifestContainerGrantProjection.manifestHash;
}) {
  return and(
    eq(accessManifestHeads.objectKind, "container"),
    eq(accessManifestHeads.objectId, projection.containerId),
    eq(accessManifestHeads.manifestHash, projection.manifestHash),
  );
}

/**
 * Seed containers: those whose current head grants the requester directly or
 * through a group they are currently in. Every container the requester can
 * read lies at or below one of these.
 */
export async function listRequesterSeedContainerIds(
  executor: DatabaseSession,
  userId: string,
): Promise<string[]> {
  const groupIds = await listCurrentGroupIdsForUser(executor, userId);
  const subjects: Array<{ ids: readonly string[]; type: "group" | "user" }> = [
    { ids: [userId], type: "user" },
    ...batches(groupIds).map((ids) => ({ ids, type: "group" as const })),
  ];
  const containerIds: string[] = [];
  for (const subject of subjects) {
    const rows = await executor
      .select({
        containerId: accessManifestContainerGrantProjection.containerId,
      })
      .from(accessManifestContainerGrantProjection)
      .innerJoin(
        accessManifestHeads,
        currentContainerHeadJoin(accessManifestContainerGrantProjection),
      )
      .where(
        and(
          eq(accessManifestContainerGrantProjection.subjectType, subject.type),
          inArray(accessManifestContainerGrantProjection.subjectId, [
            ...subject.ids,
          ]),
        ),
      );
    containerIds.push(...rows.map((row) => row.containerId));
  }
  return uniqueSortedStrings(containerIds);
}

/**
 * The principals whose presence on a verified path obliges a client to fetch
 * this bundle. A group is its own reference. An organization is never granted
 * or cited by a container, but a client verifying any of the organization's
 * groups first loads the organization bundle, and a group signed by an
 * organization admin is checked against the Admins bundle, so every group of
 * the organization references both.
 */
export async function listReferencingPrincipals(
  executor: DatabaseSession,
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): Promise<ReadonlySet<string>> {
  const self = principalReferenceKey(principal);
  const organizationId =
    principal.principalType === "organization"
      ? principal.principalId
      : await organizationIdOfAdminsGroup(executor, principal.principalId);
  if (organizationId === null) {
    return new Set([self]);
  }
  const organizationGroups = await executor
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.organizationId, organizationId));
  return new Set([
    self,
    ...organizationGroups.map((group) =>
      principalReferenceKey({ principalId: group.id, principalType: "group" }),
    ),
  ]);
}

/** The organization whose Admins group this is, or null for any other group. */
async function organizationIdOfAdminsGroup(
  executor: DatabaseSession,
  groupId: string,
): Promise<string | null> {
  const [organization] = await executor
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.adminGroupId, groupId))
    .limit(1);
  return organization?.id ?? null;
}

export function principalReferenceKey(principal: {
  readonly principalType: ManagedRecipientPrincipalType;
  readonly principalId: string;
}): string {
  return `${principal.principalType}:${principal.principalId}`;
}

/**
 * Referencing containers below a seed are found by a scan the requester
 * cannot widen, capped here in container-id order; a requester granted above
 * more than this many referencing containers verifies the first of them by
 * id. The search anchored to the requester's own paths is not capped.
 */
const MAX_REFERENCING_CONTAINER_SCAN = 256;

function referencingPrincipalsByType(
  referencing: ReadonlySet<string>,
): Map<ManagedRecipientPrincipalType, string[]> {
  const byType = new Map<ManagedRecipientPrincipalType, string[]>();
  for (const key of referencing) {
    const [principalType, principalId] = key.split(":");
    if (
      (principalType === "group" || principalType === "organization") &&
      principalId
    ) {
      byType.set(principalType, [
        ...(byType.get(principalType) ?? []),
        principalId,
      ]);
    }
  }
  return byType;
}

type ReferencingScope = ReadonlyArray<string> | undefined;

function listGrantingContainerRows(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  batch: readonly string[],
  scope: ReferencingScope,
) {
  const rows = executor
    .select({
      containerId: accessManifestContainerGrantProjection.containerId,
    })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      accessManifestHeads,
      currentContainerHeadJoin(accessManifestContainerGrantProjection),
    )
    .where(
      and(
        eq(accessManifestContainerGrantProjection.subjectType, principalType),
        inArray(accessManifestContainerGrantProjection.subjectId, batch),
        scope === undefined
          ? undefined
          : inArray(accessManifestContainerGrantProjection.containerId, scope),
      ),
    )
    .orderBy(asc(accessManifestContainerGrantProjection.containerId));
  return scope === undefined
    ? rows.limit(MAX_REFERENCING_CONTAINER_SCAN)
    : rows;
}

function listCitingContainerRows(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  batch: readonly string[],
  scope: ReferencingScope,
) {
  const rows = executor
    .select({ containerId: accessManifestPrincipalHeadProjection.objectId })
    .from(accessManifestPrincipalHeadProjection)
    .innerJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestPrincipalHeadProjection.objectId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestPrincipalHeadProjection.manifestHash,
        ),
      ),
    )
    .where(
      and(
        eq(accessManifestPrincipalHeadProjection.objectKind, "container"),
        eq(accessManifestPrincipalHeadProjection.principalType, principalType),
        inArray(accessManifestPrincipalHeadProjection.principalId, batch),
        scope === undefined
          ? undefined
          : inArray(accessManifestPrincipalHeadProjection.objectId, scope),
      ),
    )
    .orderBy(asc(accessManifestPrincipalHeadProjection.objectId));
  return scope === undefined
    ? rows.limit(MAX_REFERENCING_CONTAINER_SCAN)
    : rows;
}

/**
 * Containers whose current head grants or cites one of the referencing
 * principals: the places a verified path picks the principal up. With
 * `withinContainerIds` the search is anchored to those containers (the
 * requester's own root paths) and is exact; without it the search is a scan
 * over the referencing principals' grants, capped by
 * `MAX_REFERENCING_CONTAINER_SCAN`.
 */
export async function listContainerIdsReferencingPrincipals(
  executor: DatabaseSession,
  referencing: ReadonlySet<string>,
  options: { readonly withinContainerIds?: ReadonlyArray<string> } = {},
): Promise<string[]> {
  const within = options.withinContainerIds;
  if (within !== undefined && within.length === 0) {
    return [];
  }
  const containerIds: string[] = [];
  const withinBatches = within === undefined ? [undefined] : batches(within);
  for (const [principalType, principalIds] of referencingPrincipalsByType(
    referencing,
  )) {
    for (const batch of batches(principalIds)) {
      for (const scope of withinBatches) {
        const granting = await listGrantingContainerRows(
          executor,
          principalType,
          batch,
          scope,
        );
        const citing = await listCitingContainerRows(
          executor,
          principalType,
          batch,
          scope,
        );
        containerIds.push(
          ...[...granting, ...citing].map((row) => row.containerId),
        );
      }
    }
  }
  return uniqueSortedStrings(containerIds).slice(
    0,
    within === undefined ? MAX_REFERENCING_CONTAINER_SCAN : undefined,
  );
}

/** Parent ids for every container reachable upward from `containerIds`. */
export async function loadAncestorParents(
  executor: DatabaseSession,
  containerIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string | null>> {
  const parentById = new Map<string, string | null>();
  let frontier = uniqueSortedStrings(containerIds);
  for (
    let depth = 0;
    frontier.length > 0 && depth < MAX_ANCESTOR_WALK_DEPTH;
    depth += 1
  ) {
    const next = new Set<string>();
    for (const batch of batches(frontier)) {
      const rows = await executor
        .select({ id: containers.id, parentId: containers.parentId })
        .from(containers)
        .where(inArray(containers.id, batch));
      for (const row of rows) {
        parentById.set(row.id, row.parentId);
        if (row.parentId !== null && !parentById.has(row.parentId)) {
          next.add(row.parentId);
        }
      }
    }
    frontier = [...next];
  }
  return parentById;
}

export function ancestorsOrSelf(
  containerId: string,
  parentById: ReadonlyMap<string, string | null>,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = containerId;
  while (
    typeof current === "string" &&
    !seen.has(current) &&
    chain.length <= MAX_ANCESTOR_WALK_DEPTH
  ) {
    seen.add(current);
    chain.push(current);
    current = parentById.get(current);
  }
  return chain;
}

/**
 * The containers whose readability by the requester proves a verification
 * dependency on the principal: a seed at or below a referencing container
 * (the seed's own path cites the principal), and a referencing container at
 * or below a seed (the requester reads it through that seed).
 */
export function selectCandidateContainerIds(input: {
  readonly parentById: ReadonlyMap<string, string | null>;
  readonly referencing: ReadonlyArray<string>;
  readonly seeds: ReadonlyArray<string>;
}): string[] {
  const seeds = new Set(input.seeds);
  const referencing = new Set(input.referencing);
  const candidates = new Set<string>();
  for (const seed of input.seeds) {
    if (
      ancestorsOrSelf(seed, input.parentById).some((id) => referencing.has(id))
    ) {
      candidates.add(seed);
    }
  }
  for (const container of input.referencing) {
    if (
      ancestorsOrSelf(container, input.parentById).some((id) => seeds.has(id))
    ) {
      candidates.add(container);
    }
  }
  return uniqueSortedStrings([...candidates]);
}

/** Whether the user is currently in any group of the organization. */
export async function isCurrentMemberOfAnyOrganizationGroup(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const groupIds = await listCurrentGroupIdsForUser(executor, userId);
  for (const batch of batches(groupIds)) {
    const [row] = await executor
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.organizationId, organizationId),
          inArray(groups.id, batch),
        ),
      )
      .limit(1);
    if (row) return true;
  }
  return false;
}
