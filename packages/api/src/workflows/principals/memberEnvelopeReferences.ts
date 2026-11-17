import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  CommitOrganizationGroupPolicyRequest,
  CreateOrganizationGroupWithPolicyRequest,
  DeleteOrganizationGroupRequest,
  PrincipalMemberEnvelopeRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import { listPrincipalMemberEnvelopesForState } from "../../access/read/principalMemberEnvelopes";
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
export async function rebuildMemberEnvelopes(
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
  if (predecessor.length === 0)
    throw new PrincipalPolicyError(
      "Member envelope changes cite an unknown predecessor state",
      409,
    );
  if (predecessor.some((envelope) => envelope.epoch !== keyEpoch))
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
  return { ...rest, memberEnvelopes: [...merged.values()] };
}

/** Every leg of a group policy commit, rebuilt. */
export async function rebuildCommitMemberEnvelopes(
  executor: DatabaseSession,
  request: CommitOrganizationGroupPolicyRequest,
): Promise<CommitOrganizationGroupPolicyRequest> {
  return {
    ...request,
    groupPolicy: await rebuildMemberEnvelopes(executor, request.groupPolicy),
    ...(request.memberPolicy
      ? {
          memberPolicy: await rebuildMemberEnvelopes(
            executor,
            request.memberPolicy,
          ),
        }
      : {}),
    organizationPolicy: await rebuildMemberEnvelopes(
      executor,
      request.organizationPolicy,
    ),
  };
}

/** The organization leg of a group create or delete, rebuilt. */
export async function rebuildOrganizationLegMemberEnvelopes<
  Request extends
    | CreateOrganizationGroupWithPolicyRequest
    | DeleteOrganizationGroupRequest,
>(executor: DatabaseSession, request: Request): Promise<Request> {
  return {
    ...request,
    organizationPolicy: await rebuildMemberEnvelopes(
      executor,
      request.organizationPolicy,
    ),
  };
}
