import {
  getOrganizationPolicyHistoryOperation,
  operationRequestPathWithQuery,
} from "@tearleads/validators/operation";
import {
  type OrganizationPolicyHistoryResponse,
  OrganizationPolicyHistoryResponseSchema,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import type { RequestResultOptions } from "./types";

export function getOrganizationPolicyHistoryResult(
  runtime: ApiRequestRuntime,
  organizationId: string,
  stateHash: string,
  options: RequestResultOptions & {
    readonly beforeVersion?: number | undefined;
  } = {},
) {
  const { beforeVersion, ...requestOptions } = options;
  const operation = getOrganizationPolicyHistoryOperation;
  return principalHistoryRequest(runtime, {
    path: operationRequestPathWithQuery(
      operation,
      { organizationId },
      { stateHash, beforeVersion },
    ),
    method: "GET",
    operation,
    options: requestOptions,
    validator: (value: unknown): value is OrganizationPolicyHistoryResponse =>
      OrganizationPolicyHistoryResponseSchema.safeParse(value).success,
  });
}
