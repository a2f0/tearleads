import type { RequestFailureKind } from "@tearleads/api-client";
import type {
  CommitOrganizationGroupPolicyRequest,
  CreateOrganizationGroupWithPolicyRequest,
} from "@tearleads/validators/request";
import type {
  CommitOrganizationGroupPolicyResponse,
  CreateOrganizationGroupResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";

export interface PrincipalPolicyReadApi {
  /** Resolve authored work before reading the state for a new mutation. */
  readonly recoverPendingPrincipalMutation?:
    | ((organizationId: string) => Promise<void>)
    | undefined;
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}

export interface PrincipalPolicyReadWriteApi extends PrincipalPolicyReadApi {
  commitOrganizationGroupPolicy: (
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
  ) => Promise<CommitOrganizationGroupPolicyResponse | null>;
  /**
   * Optional status-bearing variant. A rematerialized rotation the server
   * refuses for stranding a granted path names the descendant rekeys the batch
   * must carry; without this the refusal is a plain failure.
   */
  commitOrganizationGroupPolicyResult?: (
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
    options?: { readonly reportErrors?: boolean | undefined },
  ) => Promise<
    | {
        readonly ok: true;
        readonly data: CommitOrganizationGroupPolicyResponse;
      }
    | {
        readonly ok: false;
        readonly kind?: RequestFailureKind | undefined;
        readonly message?: string | undefined;
        readonly code?: string | undefined;
        readonly report?: (() => void) | undefined;
        readonly requiredContainerIds?: readonly string[] | undefined;
        readonly status: number | null;
      }
  >;
}

export interface OrganizationPrincipalPolicyApi extends PrincipalPolicyReadApi {
  createOrganizationGroup: (
    organizationId: string,
    input: CreateOrganizationGroupWithPolicyRequest,
  ) => Promise<CreateOrganizationGroupResponse | null>;
}
