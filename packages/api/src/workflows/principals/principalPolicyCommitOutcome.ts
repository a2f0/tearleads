import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import { computePrincipalStateHash } from "@tearleads/crypto";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import {
  type CommitOrganizationGroupPolicyResponse,
  isCommitOrganizationGroupPolicyResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { loadExactReplayMutationResponses } from "./principalPolicyMutationAcknowledgements";
import { principalPolicyOutcomeHash } from "./principalPolicyOutcomeHash";
import { PrincipalPolicyError } from "./shared";

interface CommitOutcomeInput {
  readonly organizationId: string;
  readonly groupId: string;
  readonly requesterUserId: string;
  readonly request: CommitOrganizationGroupPolicyRequest;
}

function commitRequestHash(input: CommitOutcomeInput): string {
  return principalPolicyOutcomeHash([
    "tearleads.principal-policy.commit.v1",
    input.organizationId,
    input.groupId,
    input.requesterUserId,
    input.request,
  ]);
}

export async function principalPolicyCommitOutcome(
  executor: DatabaseTransaction,
  input: CommitOutcomeInput,
): Promise<{
  response: CommitOrganizationGroupPolicyResponse | null;
  save(policy: CommitOrganizationGroupPolicyResponse): Promise<void>;
}> {
  const requestHash = commitRequestHash(input);
  const [row] = await executor
    .select()
    .from(principalPolicyCommits)
    .where(
      and(
        eq(principalPolicyCommits.requestHash, requestHash),
        eq(principalPolicyCommits.organizationId, input.organizationId),
        eq(principalPolicyCommits.groupId, input.groupId),
        eq(principalPolicyCommits.requesterUserId, input.requesterUserId),
      ),
    )
    .limit(1);
  let response: CommitOrganizationGroupPolicyResponse | null = null;
  if (row) {
    await requireDirectOrganizationAccess({
      executor,
      organizationId: input.organizationId,
      requireAdmin: true,
      userId: input.requesterUserId,
    });
    let stored: unknown;
    try {
      stored = JSON.parse(row.responseJson);
    } catch {
      throw new PrincipalPolicyError(
        "Stored principal policy acknowledgement is invalid",
        409,
      );
    }
    if (
      !isCommitOrganizationGroupPolicyResponse(stored) ||
      stored.groupPolicy.currentState.principalType !== "group" ||
      stored.groupPolicy.currentState.principalId !== input.groupId ||
      stored.organizationPolicy.currentState.principalType !== "organization" ||
      stored.organizationPolicy.currentState.principalId !==
        input.organizationId ||
      stored.groupPolicy.currentState.stateHash !==
        (await computePrincipalStateHash(input.request.groupPolicy.state)) ||
      stored.organizationPolicy.currentState.stateHash !==
        (await computePrincipalStateHash(
          input.request.organizationPolicy.state,
        ))
    )
      throw new PrincipalPolicyError(
        "Stored principal policy acknowledgement does not match its request",
        409,
      );
    // Purging organization containers removes their acknowledgement rows. Never resurrect those
    // responses from a second copy inside the compound receipt.
    stored.groupPolicy.containerMutations =
      await loadExactReplayMutationResponses({
        executor,
        nextHead: stored.groupPolicy.currentState,
        requests: input.request.groupPolicy.containerMutations ?? [],
      });
    response = stored;
  }
  return {
    response,
    async save(policy: CommitOrganizationGroupPolicyResponse): Promise<void> {
      await executor.insert(principalPolicyCommits).values({
        requestHash,
        organizationId: input.organizationId,
        groupId: input.groupId,
        requesterUserId: input.requesterUserId,
        responseJson: JSON.stringify({
          ...policy,
          groupPolicy: { ...policy.groupPolicy, containerMutations: [] },
        }),
      });
    },
  };
}
