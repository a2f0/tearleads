import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  type CommitOrganizationGroupPolicyResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyReadWriteApi } from "../principalPolicy/principalPolicyApi";

/**
 * Commit, answering one refusal: a rematerialized rekey or revoke that would
 * strand a level above a directly granted container is refused with the
 * descendant rekeys it must carry. The refused attempt rolled back whole, so
 * the served heads still stand; the batch is signed again with the named
 * levels woven in, replaces the container mutations, and the commit is retried
 * once. A second refusal means the tree moved underneath, and the caller's own
 * retry starts from a fresh policy.
 */
export async function submitGroupPolicyCommit(input: {
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly carryDescendantRekeys?:
    | ((
        requiredContainerIds: readonly string[],
      ) => Promise<readonly ContainerMutationRequest[]>)
    | undefined;
  readonly groupId: string;
  readonly organizationId: string;
  readonly organizationRequest: PutPrincipalPolicyRequest;
  readonly memberRequest?: PutPrincipalPolicyRequest | undefined;
  readonly request: PutPrincipalPolicyRequest;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<CommitOrganizationGroupPolicyResponse | null> {
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
  const first = await commitOrganizationGroupPolicyResult.call(
    input.apiClient,
    input.organizationId,
    input.groupId,
    body(),
    { reportErrors: false },
  );
  if (first.ok) return first.data;
  if (first.kind === "cancelled") return null;
  if (first.kind === "outcome-unknown")
    throw new Error(
      first.message ??
        "Policy request may have committed; refresh before retrying",
    );
  if (
    input.memberRequest &&
    first.code === CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired
  ) {
    throw new Error(
      "Repair the affected container keys before retrying enrollment; no memberships were changed",
    );
  }
  if (
    !input.carryDescendantRekeys ||
    first.code !== CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired ||
    !first.requiredContainerIds?.length
  ) {
    first.report?.();
    return null;
  }
  let carried: readonly ContainerMutationRequest[];
  try {
    carried = await input.carryDescendantRekeys(first.requiredContainerIds);
  } catch (error) {
    // The refusal was answerable, and the answer failed: surface both. Once
    // the generation that owned the attempt is gone, only the failure is
    // surfaced; a superseded refusal is not an error.
    if (input.stillCurrent?.() !== false) first.report?.();
    throw error;
  }
  if (input.stillCurrent?.() === false) return null;
  // Nothing signed means the same refusal again; report the one already had.
  if (carried.length === 0) {
    first.report?.();
    return null;
  }
  input.request.containerMutations = [...carried];
  const second = await commitOrganizationGroupPolicyResult.call(
    input.apiClient,
    input.organizationId,
    input.groupId,
    body(),
    { reportErrors: false },
  );
  if (!second.ok) {
    if (second.kind === "cancelled") return null;
    if (second.kind === "outcome-unknown")
      throw new Error(
        second.message ??
          "Policy request may have committed; refresh before retrying",
      );
    second.report?.();
    return null;
  }
  return second.data;
}
