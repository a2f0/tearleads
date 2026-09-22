import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  containers,
  groups,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
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
 * groups first loads the organization bundle, so every group of the
 * organization references it.
 */
export async function listReferencingPrincipals(
  executor: DatabaseSession,
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): Promise<ReadonlySet<string>> {
  if (principal.principalType !== "organization") {
    return new Set([principalReferenceKey(principal)]);
  }
  const organizationGroups = await executor
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.organizationId, principal.principalId));
  return new Set([
    principalReferenceKey(principal),
    ...organizationGroups.map((group) =>
      principalReferenceKey({ principalId: group.id, principalType: "group" }),
    ),
  ]);
}

export function principalReferenceKey(principal: {
  readonly principalType: ManagedRecipientPrincipalType;
  readonly principalId: string;
}): string {
  return `${principal.principalType}:${principal.principalId}`;
}

/**
 * Containers whose current head grants or cites one of the referencing
 * principals: the places a verified path picks the principal up, so that a
 * client verifying any container at or below one of them must fetch this
 * bundle.
 */
export async function listContainerIdsReferencingPrincipals(
  executor: DatabaseSession,
  referencing: ReadonlySet<string>,
): Promise<string[]> {
  const containerIds: string[] = [];
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
  for (const [principalType, principalIds] of byType) {
    for (const batch of batches(principalIds)) {
      const [granting, citing] = await Promise.all([
        executor
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
              eq(
                accessManifestContainerGrantProjection.subjectType,
                principalType,
              ),
              inArray(accessManifestContainerGrantProjection.subjectId, batch),
            ),
          ),
        executor
          .select({
            containerId: accessManifestPrincipalHeadProjection.objectId,
          })
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
              eq(
                accessManifestPrincipalHeadProjection.principalType,
                principalType,
              ),
              inArray(accessManifestPrincipalHeadProjection.principalId, batch),
            ),
          ),
      ]);
      containerIds.push(
        ...[...granting, ...citing].map((row) => row.containerId),
      );
    }
  }
  return uniqueSortedStrings(containerIds);
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

function ancestorsOrSelf(
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
