import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  groups,
  organizationRosterEntries,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  getCurrentPrincipalStates,
  listProjectionMembersForState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { uniqueSortedStrings } from "../../utils/array";
import type { ContainerAccessProjection } from "../containers/writerProjection";
import { resolveReadableContainerAccessBatch } from "../keyingReadAccess";
import { PrincipalPolicyError } from "./shared";

/**
 * Seed containers examined for a requester who is neither on the roster nor
 * in the projection. A seed is a container whose current head grants the
 * requester directly or through a group they are currently in; its verified
 * path cites every principal head the requester's client must fetch to verify
 * that access. The cap bounds the read-access resolution for one request; a
 * requester with more seeds than this who is also outside the roster and
 * projection is not a shape any product flow produces.
 */
const MAX_REFERENCING_SEED_CONTAINERS = 64;

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
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
      ),
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
    )
    .orderBy(asc(accessManifestContainerGrantProjection.containerId))
    .limit(MAX_REFERENCING_SEED_CONTAINERS);
  return uniqueSortedStrings(rows.map((row) => row.containerId));
}

/**
 * Containers whose current head grants the principal directly. A requester
 * who can read one of them (through a grant on it or on an ancestor) has the
 * principal on the path their client verifies, even though the requester's
 * own seed containers sit above the grant and never cite it.
 */
async function listContainerIdsGrantingPrincipal(
  executor: DatabaseSession,
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): Promise<string[]> {
  const rows = await executor
    .select({
      containerId: accessManifestContainerGrantProjection.containerId,
    })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
      ),
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
    )
    .orderBy(asc(accessManifestContainerGrantProjection.containerId))
    .limit(MAX_REFERENCING_SEED_CONTAINERS);
  return uniqueSortedStrings(rows.map((row) => row.containerId));
}

async function canReadContainerGrantingPrincipal(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  userId: string,
): Promise<boolean> {
  const containerIds = await listContainerIdsGrantingPrincipal(
    executor,
    currentState,
  );
  if (containerIds.length === 0) {
    return false;
  }
  const results = await resolveReadableContainerAccessBatch({
    containerIds,
    executor,
    userId,
  });
  return Array.from(results.values()).some(
    (result) => result.status === "fulfilled",
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
 */
async function holdsGrantReferencingPrincipal(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  userId: string,
): Promise<boolean> {
  const seedContainerIds = await listRequesterSeedContainerIds(
    executor,
    userId,
  );
  if (seedContainerIds.length === 0) {
    return false;
  }
  const results = await resolveReadableContainerAccessBatch({
    containerIds: seedContainerIds,
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
  if (
    await canReadContainerGrantingPrincipal(
      executor,
      currentState,
      requesterUserId,
    )
  ) {
    return;
  }
  throw new PrincipalPolicyError("Principal policy access denied", 403);
}
