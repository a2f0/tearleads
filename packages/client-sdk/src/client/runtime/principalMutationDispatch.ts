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
import { withCanonicalEnvelopeOrder } from "../../data/principals/memberEnvelopeReferences";
import type { AuthoredPrincipalMutation } from "../../data/principals/principalMutationJournal";
import type { PrincipalMutationResponse } from "../../workflows/organizations";
import {
  type PrincipalMutationJournalContext,
  submitJournaledPrincipalMutation,
} from "../../workflows/organizations";
import type { createPrincipalMutationDispatcher } from "./principalMutationDeadline";
import { sendWithHeldEnvelopeChanges } from "./principalMutationWireForm";

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

/** Each journaled request goes out inside the mutation deadline. */
function sendByReference(input: {
  readonly api: ApiClient;
  readonly dispatch: ReturnType<typeof createPrincipalMutationDispatcher>;
  readonly journal: Omit<PrincipalMutationJournalContext, "submit">;
  readonly options: RequestResultOptions;
  readonly organizationId: string;
}): PrincipalMutationJournalContext["submit"] {
  return (saved) =>
    input.dispatch(input.options, (dispatchOptions) =>
      sendWithHeldEnvelopeChanges({
        execSql: input.journal.execSql,
        saved,
        send: (mutation) =>
          dispatchAuthoredPrincipalMutation(
            input.api,
            input.organizationId,
            mutation,
            dispatchOptions,
          ),
        signal: dispatchOptions.signal,
        stillCurrent: input.journal.stillCurrent,
      }),
    );
}

function unsupportedMutation(_mutation: never): never {
  throw new Error("Unsupported principal mutation operation");
}

export function createJournaledPrincipalMutations(
  api: ApiClient,
  context: (
    organizationId: string,
  ) => Omit<PrincipalMutationJournalContext, "submit">,
  dispatch: ReturnType<typeof createPrincipalMutationDispatcher>,
): JournaledPrincipalMutationMethods {
  async function submit<T extends PrincipalMutationResponse>(
    organizationId: string,
    mutation: AuthoredPrincipalMutation,
    validator: (value: unknown) => value is T,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<T>> {
    const journal = context(organizationId);
    const result = await submitJournaledPrincipalMutation({
      ...journal,
      // Sealed in canonical envelope order, so every attempt and any API
      // version key it alike (#2903 P17); recovery replays it verbatim.
      mutation: withCanonicalEnvelopeOrder(mutation),
      submit: sendByReference({
        api,
        dispatch,
        journal,
        options,
        organizationId,
      }),
    });
    if (!result.ok) return result;
    // The session already verified this operation before clearing its row.
    // This check narrows the union for each existing public API signature.
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
      { kind: "compound", groupId, request },
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
