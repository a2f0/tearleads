import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type {
  CommitOrganizationGroupPolicyResponse,
  CurrentPrincipalMemberEnvelopesResponse,
  OrganizationPolicyHistoryResponse,
} from "@tearleads/validators/response";
import { getOrganizationPolicyHistoryResult as organizationHistory } from "../organizationPolicyHistory";
import type { PrincipalPolicyPageReadOptions } from "../principalPolicyPages";
import { PrincipalPolicyRequests } from "../principalPolicyRequests";
import { bindPrototypeMethods } from "../requestInternals";
import type { RequestResult, RequestResultOptions } from "../types";
import { type ApiClientContext, dataOrNull } from "./apiClientContext";
import type { ApiClientSelf } from "./apiClientSelf";

/** Signed principal policies: pages, heads, writes, and group lifecycles. */
export class PrincipalPolicyArea {
  private readonly policies: PrincipalPolicyRequests;

  constructor(
    private readonly context: ApiClientContext,
    private readonly self: Pick<
      ApiClientSelf,
      | "commitOrganizationGroupPolicyResult"
      | "createOrganizationGroupResult"
      | "deleteOrganizationGroupResult"
    >,
  ) {
    bindPrototypeMethods(this, PrincipalPolicyArea.prototype);
    this.policies = new PrincipalPolicyRequests(
      context.runtime,
      context.principalPolicyRequestsByKey,
      context.clearWriterProjectionCaches,
    );
  }

  getPrincipalPolicyPages(
    principalType: "group" | "organization",
    principalId: string,
    options: PrincipalPolicyPageReadOptions = {},
  ) {
    return this.policies.pages(principalType, principalId, options);
  }

  /** Unpinned discovery; `ifHead` asks for a bare head when it is still live. */
  getPrincipalPolicyDiscovery(
    ...args: Parameters<PrincipalPolicyRequests["discover"]>
  ) {
    return this.policies.discover(...args);
  }

  /** One named state's member envelopes, as the request result. */
  getPrincipalMemberEnvelopesResult(
    principalType: "group" | "organization",
    principalId: string,
    stateHash: string,
  ): Promise<RequestResult<CurrentPrincipalMemberEnvelopesResponse>> {
    return this.policies.memberEnvelopes(principalType, principalId, stateHash);
  }

  getProjectionPolicyHistoryPages(
    ...args: Parameters<PrincipalPolicyRequests["publicPages"]>
  ) {
    return this.policies.publicPages(...args);
  }

  getCurrentPrincipalPolicy(
    ...args: Parameters<PrincipalPolicyRequests["get"]>
  ) {
    return this.policies.get(...args);
  }

  putPrincipalPolicy(...args: Parameters<PrincipalPolicyRequests["put"]>) {
    return this.policies.put(...args);
  }

  /** Preserves unknown outcomes for authored organization directory writes. */
  putPrincipalPolicyResult(
    ...args: Parameters<PrincipalPolicyRequests["putResult"]>
  ) {
    return this.policies.putResult(...args);
  }

  commitOrganizationGroupPolicy(
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
  ) {
    return this.self
      .commitOrganizationGroupPolicyResult(organizationId, groupId, input)
      .then(dataOrNull);
  }

  /**
   * Status-bearing group policy commit. A rematerialized rotation the server
   * refuses for stranding a granted path names the descendant rekeys the batch
   * must carry, which the plain method collapses to null.
   */
  async commitOrganizationGroupPolicyResult(
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<CommitOrganizationGroupPolicyResponse>> {
    return this.policies.commitResult(organizationId, groupId, input, options);
  }

  getOrganizationPolicyHistoryResult(
    organizationId: string,
    stateHash: string,
    options: Parameters<typeof organizationHistory>[3] = {},
  ): Promise<RequestResult<OrganizationPolicyHistoryResponse>> {
    return organizationHistory(
      this.context.runtime,
      organizationId,
      stateHash,
      options,
    );
  }

  createOrganizationGroup(
    ...args: Parameters<PrincipalPolicyRequests["createResult"]>
  ) {
    return this.self.createOrganizationGroupResult(...args).then(dataOrNull);
  }

  createOrganizationGroupResult(
    ...args: Parameters<PrincipalPolicyRequests["createResult"]>
  ) {
    return this.policies.createResult(...args);
  }

  deleteOrganizationGroup(
    ...args: Parameters<PrincipalPolicyRequests["deleteResult"]>
  ) {
    return this.self.deleteOrganizationGroupResult(...args).then(dataOrNull);
  }

  deleteOrganizationGroupResult(
    ...args: Parameters<PrincipalPolicyRequests["deleteResult"]>
  ) {
    return this.policies.deleteResult(...args);
  }
}
