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
  type OrganizationReadModelDeltaResponse,
} from "@tearleads/validators/response";
import type { AuthoredPrincipalMutation } from "../../data/principals/principalMutationJournal";
import type { PrincipalMutationResponse } from "../../workflows/organizations";
import {
  beginCommittedReadModel,
  type PrincipalMutationJournalContext,
  submitJournaledPrincipalMutation,
} from "../../workflows/organizations";

import type { createPrincipalMutationDispatcher } from "./principalMutationDeadline";

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

/** Dispatch the authenticated operation, with no application planning callback. */
export function dispatchAuthoredPrincipalMutation(
  api: ApiClient,
  organizationId: string,
  mutation: AuthoredPrincipalMutation,
  options: RequestResultOptions = {},
): Promise<RequestResult<PrincipalMutationResponse>> {
  switch (mutation.kind) {
    case "organization":
      return api.putPrincipalPolicyResult(
        "organization",
        organizationId,
        mutation.request,
        options,
      );
    case "group-create":
      return api.createOrganizationGroupResult(
        organizationId,
        mutation.request,
        options,
      );
    case "group-delete":
      return api.deleteOrganizationGroupResult(
        organizationId,
        mutation.groupId,
        mutation.request,
        options,
      );
    case "compound":
      return api.commitOrganizationGroupPolicyResult(
        organizationId,
        mutation.groupId,
        mutation.request,
        options,
      );
    default:
      return unsupportedMutation(mutation);
  }
}

function unsupportedMutation(_mutation: never): never {
  throw new Error("Unsupported principal mutation operation");
}

type JournalContext = (
  organizationId: string,
) => Omit<PrincipalMutationJournalContext, "submit">;

interface JournaledSubmission<T extends PrincipalMutationResponse> {
  readonly api: ApiClient;
  readonly context: JournalContext;
  readonly dispatch: ReturnType<typeof createPrincipalMutationDispatcher>;
  readonly mutation: AuthoredPrincipalMutation;
  readonly options: RequestResultOptions | undefined;
  readonly organizationId: string;
  readonly validator: (value: unknown) => value is T;
  /** Reads the read-model delta a response carries; set to send a cursor. */
  readonly committedReadModel?:
    | ((response: T) => OrganizationReadModelDeltaResponse | undefined)
    | undefined;
}

async function submitJournaled<T extends PrincipalMutationResponse>(
  input: JournaledSubmission<T>,
): Promise<RequestResult<T>> {
  const { organizationId } = input;
  const journal = input.context(organizationId);
  // A group create or group commit sends the read-model cursor its caller
  // holds, so the response can carry the delta from it.
  const lease = input.committedReadModel
    ? await beginCommittedReadModel({
        execSql: journal.execSql,
        organizationId,
        userId: journal.scope.userId,
      })
    : undefined;
  const options = lease?.heldCursor
    ? { ...input.options, readModelCursor: lease.heldCursor }
    : input.options;
  let delta: OrganizationReadModelDeltaResponse | undefined;
  try {
    const result = await submitJournaledPrincipalMutation({
      ...journal,
      mutation: input.mutation,
      submit: (saved) =>
        input.dispatch(options, (dispatchOptions) =>
          dispatchAuthoredPrincipalMutation(
            input.api,
            organizationId,
            saved,
            dispatchOptions,
          ),
        ),
    });
    if (!result.ok) return result;
    // The session already verified this operation before clearing its row.
    // This check narrows the union for each existing public API signature.
    if (!input.validator(result.data))
      throw new Error("Unexpected principal receipt operation");
    delta = input.committedReadModel?.(result.data);
    return { ok: true, data: result.data };
  } finally {
    lease?.settle(delta);
  }
}

export function createJournaledPrincipalMutations(
  api: ApiClient,
  context: JournalContext,
  dispatch: ReturnType<typeof createPrincipalMutationDispatcher>,
): JournaledPrincipalMutationMethods {
  const submit = <T extends PrincipalMutationResponse>(
    organizationId: string,
    mutation: AuthoredPrincipalMutation,
    validator: (value: unknown) => value is T,
    options: RequestResultOptions | undefined,
    committedReadModel?: (
      response: T,
    ) => OrganizationReadModelDeltaResponse | undefined,
  ) =>
    submitJournaled({
      api,
      committedReadModel,
      context,
      dispatch,
      mutation,
      options,
      organizationId,
      validator,
    });
  const commit: ApiClient["commitOrganizationGroupPolicyResult"] = (
    organizationId,
    groupId,
    request,
    options,
  ) =>
    submit(
      organizationId,
      { kind: "compound", groupId, request },
      isCommitOrganizationGroupPolicyResponse,
      options,
      (response) => response.readModel,
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
      (response) => response.readModel,
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
