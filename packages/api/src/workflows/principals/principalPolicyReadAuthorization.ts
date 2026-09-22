import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  containers,
  groups,
  organizationRosterEntries,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  getCurrentPrincipalStates,
  listProjectionMembersForState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { uniqueSortedStrings } from "../../utils/array";
import {
  type ContainerAccessProjection,
  createContainerWriterProjectionContext,
} from "../containers/writerProjection";
import { resolveReadableContainerAccessBatch } from "../keyingReadAccess";
import { PrincipalPolicyError } from "./shared";

/**
 * Containers verified per request once structure says the requester and the
 * principal meet on one path. Structural matching is exact, so this bounds
 * cryptographic work without refusing an honest reader: only a requester with
 * more than this many distinct matching containers that all fail to verify
 * would be denied.
 */
const MAX_VERIFIED_CANDIDATE_CONTAINERS = 16;
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

async function resolvePrincipalOrganizationId(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): Promise<string | null> {
  if (principalType === "organization") {
    return principalId;
  }
  const [group] = await executor
    .select({ organizationId: groups.organizationId })
    .from(groups)
    .where(eq(groups.id, principalId))
    .limit(1);
  return group?.organizationId ?? null;
}

async function isActiveRosterMember(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const [entry] = await executor
    .select({ userId: organizationRosterEntries.userId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, userId),
        eq(organizationRosterEntries.status, "active"),
      ),
    )
    .limit(1);
  return entry !== undefined;
}

async function isCurrentProjectionMember(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  userId: string,
): Promise<boolean> {
  const members = await listProjectionMembersForState(
    currentState.principalType,
    currentState.principalId,
    currentState.stateHash,
    executor,
  );
  return members.some((member) => member.userId === userId);
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
  if (rows.length === 0) {
    return [];
  }
  const currentStates = await getCurrentPrincipalStates(
    "group",
    rows.map((row) => row.principalId),
    executor,
  );
  return uniqueSortedStrings(
    rows
      .filter(
        (row) =>
          currentStates.get(row.principalId)?.stateHash === row.stateHash,
      )
      .map((row) => row.principalId),
  );
}

/** Join a grant or cited-head projection to the container's CURRENT head. */
function currentContainerHeadJoin(manifestHashColumn: {
  readonly containerId: typeof accessManifestContainerGrantProjection.containerId;
  readonly manifestHash: typeof accessManifestContainerGrantProjection.manifestHash;
}) {
  return and(
    eq(accessManifestHeads.objectKind, "container"),
    eq(accessManifestHeads.objectId, manifestHashColumn.containerId),
    eq(accessManifestHeads.manifestHash, manifestHashColumn.manifestHash),
  );
}

/**
 * Seed containers: those whose current head grants the requester directly or
 * through a group they are currently in. Every container the requester can
 * read lies at or below one of these.
 */
async function listRequesterSeedContainerIds(
  executor: DatabaseSession,
  userId: string,
): Promise<string[]> {
  const groupIds = await listCurrentGroupIdsForUser(executor, userId);
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
      or(
        and(
          eq(accessManifestContainerGrantProjection.subjectType, "user"),
          eq(accessManifestContainerGrantProjection.subjectId, userId),
        ),
        groupIds.length === 0
          ? undefined
          : and(
              eq(accessManifestContainerGrantProjection.subjectType, "group"),
              inArray(
                accessManifestContainerGrantProjection.subjectId,
                groupIds,
              ),
            ),
      ),
    );
  return uniqueSortedStrings(rows.map((row) => row.containerId));
}

/**
 * Containers whose current head grants or cites the principal: the places a
 * verified path picks the principal up, so that a client verifying any
 * container at or below one of them must fetch this bundle.
 */
async function listContainerIdsReferencingPrincipal(
  executor: DatabaseSession,
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): Promise<string[]> {
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
            principal.principalType,
          ),
          eq(
            accessManifestContainerGrantProjection.subjectId,
            principal.principalId,
          ),
        ),
      ),
    executor
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
          eq(
            accessManifestPrincipalHeadProjection.principalType,
            principal.principalType,
          ),
          eq(
            accessManifestPrincipalHeadProjection.principalId,
            principal.principalId,
          ),
        ),
      ),
  ]);
  return uniqueSortedStrings(
    [...granting, ...citing].map((row) => row.containerId),
  );
}

/** Parent ids for every container reachable upward from `containerIds`. */
async function loadAncestorParents(
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
function selectCandidateContainerIds(input: {
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
  return uniqueSortedStrings([...candidates]).slice(
    0,
    MAX_VERIFIED_CANDIDATE_CONTAINERS,
  );
}

function accessPathReferencesPrincipal(
  access: ContainerAccessProjection,
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): boolean {
  const matches = (candidate: {
    readonly principalType: ManagedRecipientPrincipalType;
    readonly principalId: string;
  }) =>
    candidate.principalType === principal.principalType &&
    candidate.principalId === principal.principalId;
  return (
    access.principalPolicies.some(matches) ||
    access.verifiedPath.some((manifest) =>
      manifest.state.referencedPrincipalHeads.some(matches),
    )
  );
}

/**
 * A requester outside the roster and projection may still hold a current
 * container grant whose verified path cites this principal: the referenced
 * heads are exactly what `listContainerDocuments` and the writer projection
 * tell that client to fetch, so refusing them would brick an honest reader.
 * Structure (current grants, cited heads, and the container tree) selects the
 * containers to check; the requester's verified read access to one of them,
 * carrying the principal on its path, is what authorizes the read.
 */
async function holdsGrantReferencingPrincipal(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  userId: string,
): Promise<boolean> {
  const [seeds, referencing] = await Promise.all([
    listRequesterSeedContainerIds(executor, userId),
    listContainerIdsReferencingPrincipal(executor, currentState),
  ]);
  if (seeds.length === 0 || referencing.length === 0) {
    return false;
  }
  const candidates = selectCandidateContainerIds({
    parentById: await loadAncestorParents(executor, [...seeds, ...referencing]),
    referencing,
    seeds,
  });
  if (candidates.length === 0) {
    return false;
  }
  const results = await resolveReadableContainerAccessBatch({
    containerIds: candidates,
    context: createContainerWriterProjectionContext(executor),
    executor,
    userId,
  });
  for (const result of results.values()) {
    if (
      result.status === "fulfilled" &&
      accessPathReferencesPrincipal(result.value, currentState)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A principal policy bundle carries the roster, admin set, per-member envelope
 * ciphertexts, key fingerprints, and grant projection, so it is served only to
 * a requester with a legitimate verification dependency on it: an active
 * roster member of its organization, a user in its current projection, or a
 * holder of a current container grant whose verified path references it, on
 * either side of the grant: a requester granted below it sees the principal
 * on their path, and a requester granted above it can read the container the
 * principal is granted on. Honest clients are always in one of those sets.
 */
export async function assertPrincipalPolicyReadable(input: {
  readonly currentState: StoredPrincipalState;
  readonly executor: DatabaseSession;
  readonly requesterUserId: string;
}): Promise<void> {
  const { currentState, executor, requesterUserId } = input;
  const organizationId = await resolvePrincipalOrganizationId(
    executor,
    currentState.principalType,
    currentState.principalId,
  );
  if (
    organizationId !== null &&
    (await isActiveRosterMember(executor, organizationId, requesterUserId))
  ) {
    return;
  }
  if (
    await isCurrentProjectionMember(executor, currentState, requesterUserId)
  ) {
    return;
  }
  if (
    await holdsGrantReferencingPrincipal(
      executor,
      currentState,
      requesterUserId,
    )
  ) {
    return;
  }
  throw new PrincipalPolicyError("Principal policy access denied", 403);
}
