import {
  commitOrganizationGroupPolicyOperation,
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
import {
  collectPrincipalPolicyPages,
  type PrincipalPolicyPageReadOptions,
  readPrincipalPolicyPages,
} from "./principalPolicyPages";
import { readProjectionPolicyHistoryPages } from "./projectionPolicyHistoryPages";
import { dedupedRequest } from "./requestInternals";
import {
  commitOrganizationGroupPolicy,
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

  publicPages(
    source: Parameters<typeof readProjectionPolicyHistoryPages>[1],
    options: Parameters<typeof readProjectionPolicyHistoryPages>[2] = {},
  ) {
    return readProjectionPolicyHistoryPages(this.runtime, source, options);
  }

  pages(
    principalType: "group" | "organization",
    principalId: string,
    options: PrincipalPolicyPageReadOptions = {},
  ) {
    return readPrincipalPolicyPages(
      this.runtime,
      principalType,
      principalId,
      options,
    );
  }

  get(
    principalType: "group" | "organization",
    principalId: string,
    options: RequestResultOptions = {},
  ) {
    const request = () =>
      collectPrincipalPolicyPages(
        this.runtime,
        principalType,
        principalId,
        options,
      );
    const key = JSON.stringify([principalType, principalId]);
    // Cancellation, reporting and renewal preferences belong to their caller.
    return Object.keys(options).length > 0
      ? request()
      : dedupedRequest(this.cache, key, request);
  }

  put(...args: Parameters<PrincipalPolicyRequests["putResult"]>) {
    return this.putResult(...args).then((result) =>
      result.ok ? result.data : null,
    );
  }

  putResult(
    principalType: "organization",
    principalId: string,
    input: OrganizationPrincipalPolicyRequest,
    options: RequestResultOptions = {},
  ) {
    const key = JSON.stringify([principalType, principalId]);
    this.cache.delete(key);
    return principalHistoryRequest(this.runtime, {
      path: putPrincipalPolicy.path(principalType, principalId),
      validator: putPrincipalPolicy.isResponse,
      method: putPrincipalPolicy.method,
      body: JSON.stringify(input),
      options: {
        expectedPaymentRequiredOrganizationId: principalId,
        ...options,
      },
      operation: putPrincipalPolicyOperation,
    }).finally(() => this.cache.delete(key));
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
