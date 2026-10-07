import type {
  ApiClient,
  RequestResult,
  RequestResultOptions,
} from "@tearleads/api-client";
import {
  isCommitOrganizationGroupPolicyResponse,
  isCreateOrganizationGroupResponse,
  isDeleteOrganizationGroupResponse,
  isPrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import type { AuthoredPrincipalMutation } from "../data/principals/principalMutationJournal";
import {
  type PrincipalMutationJournalContext,
  submitJournaledPrincipalMutation,
} from "../workflows/organizations/principalMutationJournalSession";
import type { PrincipalMutationResponse } from "../workflows/organizations/principalOperationReceipt";

export type JournaledPrincipalMutationMethods = Pick<
  ApiClient,
  | "commitOrganizationGroupPolicy"
  | "commitOrganizationGroupPolicyResult"
  | "createOrganizationGroup"
  | "createOrganizationGroupResult"
  | "deleteOrganizationGroup"
  | "deleteOrganizationGroupResult"
  | "putPrincipalPolicy"
  | "putPrincipalPolicyResult"
>;

function mutationDispatchOptions(options: RequestResultOptions) {
  const deadline = AbortSignal.timeout(15_000);
  return {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline,
  };
}

/** Dispatch the authenticated operation, with no application planning callback. */
export function dispatchAuthoredPrincipalMutation(
  api: ApiClient,
  organizationId: string,
  mutation: AuthoredPrincipalMutation,
  options: RequestResultOptions = {},
): Promise<RequestResult<PrincipalMutationResponse>> {
  const bounded = mutationDispatchOptions(options);
  switch (mutation.kind) {
    case "organization":
      return api.putPrincipalPolicyResult(
        "organization",
        organizationId,
        mutation.request,
        bounded,
      );
    case "group-create":
      return api.createOrganizationGroupResult(
        organizationId,
        mutation.request,
        bounded,
      );
    case "group-delete":
      return api.deleteOrganizationGroupResult(
        organizationId,
        mutation.groupId,
        mutation.request,
        bounded,
      );
    default:
      return api.commitOrganizationGroupPolicyResult(
        organizationId,
        mutation.groupId,
        mutation.request,
        bounded,
      );
  }
}

export function createJournaledPrincipalMutations(
  api: ApiClient,
  context: (
    organizationId: string,
  ) => Omit<PrincipalMutationJournalContext, "submit">,
): JournaledPrincipalMutationMethods {
  async function submit<T extends PrincipalMutationResponse>(
    organizationId: string,
    mutation: AuthoredPrincipalMutation,
    validator: (value: unknown) => value is T,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<T>> {
    const result = await submitJournaledPrincipalMutation({
      ...context(organizationId),
      mutation,
      submit: (saved) =>
        dispatchAuthoredPrincipalMutation(api, organizationId, saved, options),
    });
    if (!result.ok) return result;
    if (!validator(result.data))
      throw new Error("Unexpected principal receipt operation");
    return { ok: true, data: result.data };
  }
  const commit: ApiClient["commitOrganizationGroupPolicyResult"] = (
    organizationId,
    groupId,
    request,
    options,
  ) =>
    submit(
      organizationId,
      { groupId, request },
      isCommitOrganizationGroupPolicyResponse,
      options,
    );
  const create: ApiClient["createOrganizationGroupResult"] = (
    organizationId,
    request,
    options,
  ) =>
    submit(
      organizationId,
      { kind: "group-create", groupId: request.groupId, request },
      isCreateOrganizationGroupResponse,
      options,
    );
  const remove: ApiClient["deleteOrganizationGroupResult"] = (
    organizationId,
    groupId,
    request,
    options,
  ) =>
    submit(
      organizationId,
      { kind: "group-delete", groupId, request },
      isDeleteOrganizationGroupResponse,
      options,
    );
  const put: ApiClient["putPrincipalPolicyResult"] = (
    _type,
    organizationId,
    request,
    options,
  ) =>
    submit(
      organizationId,
      { kind: "organization", groupId: null, request },
      isPrincipalPolicyMutationResponse,
      options,
    );
  return {
    commitOrganizationGroupPolicyResult: commit,
    commitOrganizationGroupPolicy: async (...args) =>
      nullable(await commit(...args)),
    createOrganizationGroupResult: create,
    createOrganizationGroup: async (...args) => nullable(await create(...args)),
    deleteOrganizationGroupResult: remove,
    deleteOrganizationGroup: async (...args) => nullable(await remove(...args)),
    putPrincipalPolicyResult: put,
    putPrincipalPolicy: async (...args) => nullable(await put(...args)),
  };
}

function nullable<T>(result: RequestResult<T>): T | null {
  return result.ok ? result.data : null;
}
