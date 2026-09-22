import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationRosterEntries,
  organizations,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { uniqueSortedStrings } from "../../utils/array";
import {
  type ContainerAccessProjection,
  type ContainerWriterProjectionContext,
  createContainerWriterProjectionContext,
} from "../containers/writerProjection";
import { resolveReadableContainerAccessBatch } from "../keyingReadAccess";
import {
  ancestorsOrSelf,
  isCurrentMemberOfAnyOrganizationGroup,
  listContainerIdsReferencingPrincipals,
  listReferencingPrincipals,
  listRequesterSeedContainerIds,
  loadAncestorParents,
  principalReferenceKey,
  selectCandidateContainerIds,
} from "./principalPolicyReadStructure";
import { PrincipalPolicyError } from "./shared";

/**
 * Containers verified per request once structure says the requester and the
 * principal meet on one path. Structural matching is exact, so this bounds
 * cryptographic work without refusing an honest reader: only a requester with
 * more than this many distinct matching containers that all fail to verify
 * would be denied.
 */
const MAX_VERIFIED_CANDIDATE_CONTAINERS = 64;
const VERIFIED_CANDIDATE_BATCH_SIZE = 16;
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

async function isOrganizationOrAdminsPrincipal(
  executor: DatabaseSession,
  organizationId: string,
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): Promise<boolean> {
  if (principal.principalType === "organization") {
    return true;
  }
  const [organization] = await executor
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organization?.adminGroupId === principal.principalId;
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
  const [member] = await executor
    .select({ userId: principalMembershipProjection.userId })
    .from(principalMembershipProjection)
    .where(
      and(
        eq(
          principalMembershipProjection.principalType,
          currentState.principalType,
        ),
        eq(principalMembershipProjection.principalId, currentState.principalId),
        eq(principalMembershipProjection.stateHash, currentState.stateHash),
        eq(principalMembershipProjection.userId, userId),
      ),
    )
    .limit(1);
  return member !== undefined;
}

function accessPathReferencesPrincipal(
  access: ContainerAccessProjection,
  referencing: ReadonlySet<string>,
): boolean {
  const matches = (candidate: {
    readonly principalType: ManagedRecipientPrincipalType;
    readonly principalId: string;
  }) => referencing.has(principalReferenceKey(candidate));
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
 * carrying the principal on its path, is what authorizes the read. Candidates
 * are verified in batches until one authorizes or the budget runs out.
 */
async function holdsGrantReferencingPrincipal(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  userId: string,
  sharedContext: ContainerWriterProjectionContext | undefined,
): Promise<boolean> {
  const seeds = await listRequesterSeedContainerIds(executor, userId);
  if (seeds.length === 0) {
    return false;
  }
  const referencingPrincipals = await listReferencingPrincipals(
    executor,
    currentState,
  );
  // Exact for a requester at or below a referencing container: the search is
  // anchored to the requester's own root paths, which the requester cannot
  // widen. A requester above a referencing container is found by a capped
  // scan of the referencing principals' current grants.
  const seedParents = await loadAncestorParents(executor, seeds);
  const seedChain = uniqueSortedStrings(
    seeds.flatMap((seed) => ancestorsOrSelf(seed, seedParents)),
  );
  const anchored = await listContainerIdsReferencingPrincipals(
    executor,
    referencingPrincipals,
    { withinContainerIds: seedChain },
  );
  const scanned =
    anchored.length > 0
      ? []
      : await listContainerIdsReferencingPrincipals(
          executor,
          referencingPrincipals,
        );
  const referencing = uniqueSortedStrings([...anchored, ...scanned]);
  if (referencing.length === 0) {
    return false;
  }
  const parentById = new Map([
    ...seedParents,
    ...(await loadAncestorParents(executor, scanned)),
  ]);
  const candidates = selectCandidateContainerIds({
    parentById,
    referencing,
    seeds,
  }).slice(0, MAX_VERIFIED_CANDIDATE_CONTAINERS);
  const context =
    sharedContext ?? createContainerWriterProjectionContext(executor);
  for (
    let index = 0;
    index < candidates.length;
    index += VERIFIED_CANDIDATE_BATCH_SIZE
  ) {
    const results = await resolveReadableContainerAccessBatch({
      containerIds: candidates.slice(
        index,
        index + VERIFIED_CANDIDATE_BATCH_SIZE,
      ),
      context,
      executor,
      userId,
    });
    for (const result of results.values()) {
      if (
        result.status === "fulfilled" &&
        accessPathReferencesPrincipal(result.value, referencingPrincipals)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A principal policy bundle carries the roster, admin set, per-member envelope
 * ciphertexts, key fingerprints, and grant projection, so it is served only to
 * a requester with a legitimate verification dependency on it: an active
 * roster member of its organization, a user in its current projection, or a
 * holder of a current container grant whose verified path references it (or,
 * for an organization, one of its groups), on either side of the grant: a
 * requester granted below it sees the principal on their path, and a
 * requester granted above it can read the container the principal is granted
 * on. Honest clients are always in one of those sets.
 */
export async function assertPrincipalPolicyReadable(input: {
  /** A writer-projection context to share across several checks. */
  readonly context?: ContainerWriterProjectionContext | undefined;
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
  // A member of any group in the organization verifies that group against
  // the organization and Admins bundles, so those two follow from membership.
  if (
    organizationId !== null &&
    (await isOrganizationOrAdminsPrincipal(
      executor,
      organizationId,
      currentState,
    )) &&
    (await isCurrentMemberOfAnyOrganizationGroup(
      executor,
      organizationId,
      requesterUserId,
    ))
  ) {
    return;
  }
  if (
    await holdsGrantReferencingPrincipal(
      executor,
      currentState,
      requesterUserId,
      input.context,
    )
  ) {
    return;
  }
  throw new PrincipalPolicyError("Principal policy access denied", 403);
}
