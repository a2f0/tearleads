import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerDeleteResponse,
  ContainerMutationResponse,
  VerifySuccessResponse,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "../apiRequestRuntime";
import type { PrincipalPolicyRequests } from "../principalPolicyRequests";
import type { RequestResult, RequestResultOptions } from "../types";

export type DeleteContainerOptions = RequestResultOptions & {
  requiredAncestorId?: string | undefined;
};

/**
 * The public client methods an area calls back through instead of calling its
 * own implementation, so a replacement assigned on the client instance (a test
 * double, a route-backed fake) is honored by the methods built on it.
 */
export interface ApiClientSelf {
  authenticateWithChallenge(
    fingerprint: string,
    secretKey: Uint8Array,
    challengeHex: string,
  ): Promise<VerifySuccessResponse | null>;
  clearWriterProjectionCaches(): void;
  commitOrganizationGroupPolicyResult: PrincipalPolicyRequests["commitResult"];
  createOrganizationGroupResult: PrincipalPolicyRequests["createResult"];
  deleteContainerResult(
    containerId: string,
    options?: DeleteContainerOptions,
  ): Promise<RequestResult<ContainerDeleteResponse>>;
  deleteOrganizationGroupResult: PrincipalPolicyRequests["deleteResult"];
  evictDocumentWriterProjection(documentId: string): void;
  getAuthToken(): string | null;
  getRequestFailure: ApiRequestRuntime["getRequestFailure"];
  shareContainerResult(
    containerId: string,
    input: ContainerMutationRequest,
    options?: RequestResultOptions,
  ): Promise<RequestResult<ContainerMutationResponse>>;
}
