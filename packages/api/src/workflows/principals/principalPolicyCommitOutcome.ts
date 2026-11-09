import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { loadExactReplayMutationResponses } from "./principalPolicyMutationAcknowledgements";
import { principalPolicyOutcomeHash } from "./principalPolicyOutcomeHash";
import { loadPrincipalPolicyOutcomeReference } from "./principalPolicyOutcomeReference";
import { storedCommitPolicyReceiptSchema } from "./principalPolicyReceiptSchema";
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
    response = await loadCommitResponse(executor, input, row.responseJson);
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
          ...(policy.memberPolicy
            ? { memberPolicy: policy.memberPolicy.head }
            : {}),
          groupPolicy: policy.groupPolicy.head,
          organizationPolicy: policy.organizationPolicy.head,
        }),
      });
    },
  };
}

type StoredCommitReceipt = z.infer<typeof storedCommitPolicyReceiptSchema>;

function readStoredCommitReceipt(responseJson: string): StoredCommitReceipt {
  let stored: StoredCommitReceipt | undefined;
  try {
    stored = storedCommitPolicyReceiptSchema.safeParse(
      JSON.parse(responseJson),
    ).data;
  } catch {
    stored = undefined;
  }
  if (!stored)
    throw new PrincipalPolicyError(
      "Stored principal policy acknowledgement is invalid",
      409,
    );
  return stored;
}

async function loadMemberOutcome(
  executor: DatabaseTransaction,
  input: CommitOutcomeInput,
  stored: StoredCommitReceipt,
) {
  const memberPolicy = input.request.memberPolicy
    ? await loadPrincipalPolicyOutcomeReference({
        executor,
        reference: stored.memberPolicy,
        request: input.request.memberPolicy,
        principalType: "group",
        principalId: input.request.memberPolicy.state.principalId,
      })
    : null;
  if (memberPolicy) {
    memberPolicy.containerMutations = await loadExactReplayMutationResponses({
      executor,
      nextHead: memberPolicy.head,
      requests: input.request.memberPolicy?.containerMutations ?? [],
    });
  }
  return memberPolicy;
}

async function loadCommitResponse(
  executor: DatabaseTransaction,
  input: CommitOutcomeInput,
  responseJson: string,
): Promise<CommitOrganizationGroupPolicyResponse> {
  await requireDirectOrganizationAccess({
    executor,
    organizationId: input.organizationId,
    requireAdmin: true,
    userId: input.requesterUserId,
  });
  const stored = readStoredCommitReceipt(responseJson);
  const groupPolicy = await loadPrincipalPolicyOutcomeReference({
    executor,
    reference: stored.groupPolicy,
    request: input.request.groupPolicy,
    principalType: "group",
    principalId: input.groupId,
  });
  const organizationPolicy = await loadPrincipalPolicyOutcomeReference({
    executor,
    reference: stored.organizationPolicy,
    request: input.request.organizationPolicy,
    principalType: "organization",
    principalId: input.organizationId,
  });
  // Purged container acknowledgements cannot be resurrected from a receipt.
  groupPolicy.containerMutations = await loadExactReplayMutationResponses({
    executor,
    nextHead: groupPolicy.head,
    requests: input.request.groupPolicy.containerMutations ?? [],
  });
  const memberPolicy = await loadMemberOutcome(executor, input, stored);
  return {
    groupPolicy,
    organizationPolicy,
    ...(memberPolicy ? { memberPolicy } : {}),
  };
}
