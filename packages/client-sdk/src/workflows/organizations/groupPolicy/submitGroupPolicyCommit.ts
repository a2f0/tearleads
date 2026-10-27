import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  type CommitOrganizationGroupPolicyResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyReadWriteApi } from "../principalPolicy/principalPolicyApi";

type CommitFailure = Extract<
  Awaited<
    ReturnType<
      NonNullable<
        PrincipalPolicyReadWriteApi["commitOrganizationGroupPolicyResult"]
      >
    >
  >,
  { ok: false }
>;
interface CommitInput {
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly carryDescendantRekeys?:
    | ((
        requiredContainerIds: readonly string[],
      ) => Promise<readonly ContainerMutationRequest[]>)
    | undefined;
  readonly refreshContainerMutations?:
    | (() => Promise<readonly ContainerMutationRequest[]>)
    | undefined;
  readonly groupId: string;
  readonly organizationId: string;
  readonly organizationRequest: PutPrincipalPolicyRequest;
  readonly memberRequest?: PutPrincipalPolicyRequest | undefined;
  readonly request: PutPrincipalPolicyRequest;
  readonly stillCurrent?: (() => boolean) | undefined;
}

/** Answer one explicit transactional refusal, preserving uncertain outcomes. */
export async function submitGroupPolicyCommit(
  input: CommitInput,
): Promise<CommitOrganizationGroupPolicyResponse | null> {
  if (input.stillCurrent?.() === false) return null;
  const body = () => ({
    groupPolicy: input.request,
    ...(input.memberRequest ? { memberPolicy: input.memberRequest } : {}),
    organizationPolicy: input.organizationRequest,
  });
  const { commitOrganizationGroupPolicyResult } = input.apiClient;
  if (!commitOrganizationGroupPolicyResult) {
    return input.apiClient.commitOrganizationGroupPolicy(
      input.organizationId,
      input.groupId,
      body(),
    );
  }
  const submit = () =>
    commitOrganizationGroupPolicyResult.call(
      input.apiClient,
      input.organizationId,
      input.groupId,
      body(),
      { reportErrors: false },
    );
  const first = await submit();
  if (first.ok) return first.data;
  if (!isRefused(first) || input.stillCurrent?.() === false) return null;
  if (!(await answerRefusal(input, first))) return null;
  if (input.stillCurrent?.() === false) return null;
  const second = await submit();
  if (second.ok) return second.data;
  if (isRefused(second) && input.stillCurrent?.() !== false) second.report?.();
  return null;
}

function isRefused(failure: CommitFailure): boolean {
  if (failure.kind === "outcome-unknown")
    throw new Error(
      failure.message ??
        "Policy request may have committed; refresh before retrying",
    );
  return failure.kind !== "cancelled";
}

async function answerRefusal(
  input: CommitInput,
  failure: CommitFailure,
): Promise<boolean> {
  const retry = selectRetry(input, failure);
  if (!retry) {
    failure.report?.();
    return false;
  }
  try {
    const requests = await retry.prepare();
    if (input.stillCurrent?.() === false) return false;
    if (retry.requireNonempty && requests.length === 0) {
      failure.report?.();
      return false;
    }
    input.request.containerMutations = [...requests];
    return true;
  } catch (error) {
    if (input.stillCurrent?.() !== false) failure.report?.();
    throw error;
  }
}

function selectRetry(input: CommitInput, failure: CommitFailure) {
  if (failure.status !== 409) return null;
  if (
    failure.code === CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired
  ) {
    if (input.memberRequest)
      throw new Error(
        "Repair the affected container keys before retrying enrollment; no memberships were changed",
      );
    const { carryDescendantRekeys } = input;
    const { requiredContainerIds } = failure;
    return carryDescendantRekeys && requiredContainerIds?.length
      ? {
          prepare: () => carryDescendantRekeys(requiredContainerIds),
          requireNonempty: true,
        }
      : null;
  }
  // A compound retry must rebuild both batches' shared speculative paths.
  // Until it can do that, refuse atomically instead of reusing either batch.
  if (
    !input.memberRequest &&
    failure.code === CONTAINER_MUTATION_ERROR_CODES.stateStale &&
    input.refreshContainerMutations
  )
    return { prepare: input.refreshContainerMutations, requireNonempty: false };
  return null;
}
