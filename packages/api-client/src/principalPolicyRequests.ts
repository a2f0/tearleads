import {
  commitOrganizationGroupPolicyOperation,
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import type {
  CommitOrganizationGroupPolicyRequest,
  OrganizationPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { BoundedCache } from "./ApiCache";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import { dedupedRequest } from "./requestInternals";
import {
  commitOrganizationGroupPolicy,
  getPrincipalPolicy,
  putPrincipalPolicy,
} from "./routes/principals/policy";
import type { RequestResultOptions } from "./types";

export class PrincipalPolicyRequests {
  constructor(
    private readonly runtime: ApiRequestRuntime,
    private readonly cache: BoundedCache<
      Promise<PrincipalPolicyBundleResponse | null>
    >,
    private readonly clearWriterProjectionCaches: () => void,
  ) {}

  get(principalType: "group" | "organization", principalId: string) {
    return dedupedRequest(
      this.cache,
      JSON.stringify([principalType, principalId]),
      () =>
        principalHistoryRequest(this.runtime, {
          path: getPrincipalPolicy.path(principalType, principalId),
          validator: getPrincipalPolicy.isResponse,
          method: getPrincipalPolicy.method,
          operation: getPrincipalPolicyOperation,
        }).then((result) => (result.ok ? result.data : null)),
    );
  }

  put(
    principalType: "organization",
    principalId: string,
    input: OrganizationPrincipalPolicyRequest,
  ) {
    const key = JSON.stringify([principalType, principalId]);
    this.cache.delete(key);
    return principalHistoryRequest(this.runtime, {
      path: putPrincipalPolicy.path(principalType, principalId),
      validator: putPrincipalPolicy.isResponse,
      method: putPrincipalPolicy.method,
      body: JSON.stringify(input),
      options: { expectedPaymentRequiredOrganizationId: principalId },
      operation: putPrincipalPolicyOperation,
    })
      .then((result) => (result.ok ? result.data : null))
      .finally(() => this.cache.delete(key));
  }

  async commitResult(
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
    options: RequestResultOptions = {},
  ) {
    const groupKey = JSON.stringify(["group", groupId]);
    const organizationKey = JSON.stringify(["organization", organizationId]);
    this.cache.delete(groupKey);
    this.cache.delete(organizationKey);
    try {
      return await principalHistoryRequest(this.runtime, {
        path: commitOrganizationGroupPolicy.path(organizationId, groupId),
        validator: commitOrganizationGroupPolicy.isResponse,
        method: commitOrganizationGroupPolicy.method,
        body: JSON.stringify(input),
        options: {
          expectedPaymentRequiredOrganizationId: organizationId,
          ...options,
        },
        operation: commitOrganizationGroupPolicyOperation,
      });
    } finally {
      this.cache.delete(groupKey);
      this.cache.delete(organizationKey);
      this.clearWriterProjectionCaches();
    }
  }
}
