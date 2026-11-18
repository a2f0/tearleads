import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { groups, organizations } from "@tearleads/api-shared/schema";
import type {
  CommitOrganizationGroupPolicyRequest,
  PrincipalMemberEnvelopeRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import { and, eq } from "drizzle-orm";
import { listPrincipalMemberEnvelopesForState } from "../../access/read/principalMemberEnvelopes";
import { getPrincipalStatesForReferences } from "../../access/read/principalStateStore";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { PrincipalPolicyError } from "./shared";

function distinct(values: readonly string[], label: string): Set<string> {
  const set = new Set(values);
  if (set.size !== values.length)
    throw new PrincipalPolicyError(`${label} must not repeat a user`, 400);
  return set;
}

/**
 * The full member envelope set of a leg sent as changes to its predecessor's
 * (#2903 P17): the envelopes stored for `state.prevStateHash`, which never
 * change once written, less `removeUserIds`, with `upsert` added or replacing.
 * Only within the predecessor's key epoch, whose envelopes open the same key.
 * The rebuilt list then goes through the same signed-root check as a list
 * sent in full, and an outcome replay compares the rebuilt request, so either
 * form of a retry is recognized.
 */
async function rebuildMemberEnvelopes(
  executor: DatabaseSession,
  leg: PutPrincipalPolicyRequest,
): Promise<PutPrincipalPolicyRequest> {
  const changes = leg.memberEnvelopeChanges;
  if (!changes) return leg;
  const { memberEnvelopeChanges: _changes, ...rest } = leg;
  if (leg.memberEnvelopes.length > 0)
    throw new PrincipalPolicyError(
      "Member envelope changes replace the envelope list, which must be empty",
      400,
    );
  const { keyEpoch, prevStateHash, principalId, principalType } = leg.state;
  if (prevStateHash === null)
    throw new PrincipalPolicyError(
      "Member envelope changes need a predecessor state",
      400,
    );
  const predecessor = await listPrincipalMemberEnvelopesForState(
    principalType,
    principalId,
    prevStateHash,
    executor,
  );
  // An empty set has no rows to carry its epoch: read the state itself.
  const predecessorEpochs =
    predecessor.length > 0
      ? predecessor.map((envelope) => envelope.epoch)
      : [
          ...(
            await getPrincipalStatesForReferences(
              [{ principalId, principalType, stateHash: prevStateHash }],
              executor,
            )
          ).values(),
        ].map((state) => state.keyEpoch);
  if (predecessorEpochs.length === 0)
    throw new PrincipalPolicyError(
      "Member envelope changes cite an unknown predecessor state",
      409,
    );
  if (predecessorEpochs.some((epoch) => epoch !== keyEpoch))
    throw new PrincipalPolicyError(
      "Member envelope changes require the predecessor's key epoch",
      400,
    );
  const removed = distinct(changes.removeUserIds, "Member envelope removals");
  const upserted = distinct(
    changes.upsert.map((envelope) => envelope.userId),
    "Member envelope upserts",
  );
  const merged = new Map<string, PrincipalMemberEnvelopeRequest>(
    predecessor.map(
      ({ kemCipherText, memberKeyFingerprint, userId, wrappedKey }) => [
        userId,
        { kemCipherText, memberKeyFingerprint, userId, wrappedKey },
      ],
    ),
  );
  for (const userId of removed) {
    if (upserted.has(userId) || !merged.delete(userId))
      throw new PrincipalPolicyError(
        "Member envelope removals must name predecessor members only",
        400,
      );
  }
  for (const envelope of changes.upsert) merged.set(envelope.userId, envelope);
  return {
    ...rest,
    memberEnvelopes: [...merged.values()].sort((left, right) =>
      left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0,
    ),
  };
}

interface RouteScope {
  readonly organizationId: string;
  readonly requesterUserId: string;
}

function hasChanges(
  ...legs: ReadonlyArray<PutPrincipalPolicyRequest | undefined>
): boolean {
  return legs.some((leg) => leg?.memberEnvelopeChanges !== undefined);
}

/**
 * Only an organization admin's legs, each naming its route principal, read a
 * predecessor's envelopes, so the rebuild reveals no state the caller could
 * not already write. Legs sent in full pass through untouched.
 */
async function rebuildBoundLeg(
  tx: DatabaseTransaction,
  leg: PutPrincipalPolicyRequest,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PutPrincipalPolicyRequest> {
  if (!leg.memberEnvelopeChanges) return leg;
  if (
    leg.state.principalType !== principalType ||
    leg.state.principalId !== principalId
  )
    throw new PrincipalPolicyError(
      "Member envelope changes must name the route's principal",
      400,
    );
  return rebuildMemberEnvelopes(tx, leg);
}

async function requireAdmin(
  tx: DatabaseTransaction,
  scope: RouteScope,
): Promise<void> {
  await requireDirectOrganizationAccess({
    executor: tx,
    organizationId: scope.organizationId,
    requireAdmin: true,
    userId: scope.requesterUserId,
  });
}

/** Every leg of a group policy commit, rebuilt once the route is checked. */
export async function rebuildCommitMemberEnvelopes(
  tx: DatabaseTransaction,
  input: RouteScope & {
    readonly groupId: string;
    readonly request: CommitOrganizationGroupPolicyRequest;
  },
): Promise<CommitOrganizationGroupPolicyRequest> {
  const { request } = input;
  if (
    !hasChanges(
      request.groupPolicy,
      request.memberPolicy,
      request.organizationPolicy,
    )
  )
    return request;
  await requireAdmin(tx, input);
  const [route] = await tx
    .select({ memberGroupId: organizations.memberGroupId })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(
      and(
        eq(groups.id, input.groupId),
        eq(groups.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!route)
    throw new PrincipalPolicyError(
      "Group does not belong to the committed organization",
      404,
    );
  return {
    ...request,
    groupPolicy: await rebuildBoundLeg(
      tx,
      request.groupPolicy,
      "group",
      input.groupId,
    ),
    ...(request.memberPolicy
      ? {
          memberPolicy: await rebuildBoundLeg(
            tx,
            request.memberPolicy,
            "group",
            route.memberGroupId,
          ),
        }
      : {}),
    organizationPolicy: await rebuildBoundLeg(
      tx,
      request.organizationPolicy,
      "organization",
      input.organizationId,
    ),
  };
}

/**
 * The organization leg of a group create or delete, or a standalone
 * organization policy write, rebuilt once its admin is checked.
 */
export async function rebuildOrganizationLegMemberEnvelopes(
  tx: DatabaseTransaction,
  scope: RouteScope,
  leg: PutPrincipalPolicyRequest,
): Promise<PutPrincipalPolicyRequest> {
  if (!hasChanges(leg)) return leg;
  await requireAdmin(tx, scope);
  return rebuildBoundLeg(tx, leg, "organization", scope.organizationId);
}
