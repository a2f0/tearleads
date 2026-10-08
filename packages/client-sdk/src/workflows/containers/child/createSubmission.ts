import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { isStaleParentContainerPathFailure } from "../../../data/containers/shared/mutationFailures";
import type {
  ContainerCreateApi,
  ContainerCreatePlan,
  ContainerMutationAuthor,
  ContainerMutationSubmitFailure,
} from "../../../data/containers/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { SecurityIncidentReporter } from "../../../data/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import { recoverPrincipalPolicyRepair } from "../../principals/policyRepair";
import type { PrincipalPolicyRepairBudget } from "../../principals/policyRepairBudget";

export interface ContainerCreateRepairState {
  didRepairStaleParent: boolean;
  policyRepairs: PrincipalPolicyRepairBudget;
}

export interface RemoteContainerCreateInput {
  apiClient: ContainerCreateApi;
  author: ContainerMutationAuthor;
  containerId?: string | undefined;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  execSql: ExecSql;
  metadataDocumentId?: string | undefined;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  parentSecretKey: Uint8Array;
  reportSecurityIncident: SecurityIncidentReporter;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

type ContainerCreateFailureRepair =
  | { readonly kind: "none" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "retry";
      readonly parentProjection: ContainerWriterProjectionResponse;
    };

export async function submitRemoteContainerCreate(input: {
  readonly apiClient: ContainerCreateApi;
  readonly plan: ContainerCreatePlan;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly response: ContainerMutationResponse;
    }
  | ContainerMutationSubmitFailure
  | null
> {
  if (input.stillCurrent?.() === false) return null;
  const result = await input.apiClient.createContainerResult(
    input.plan.request,
    {
      expectedPaymentRequiredOrganizationId: input.plan.state.organizationId,
      reportErrors: false,
    },
  );
  return result.ok ? { ok: true, response: result.data } : result;
}

export async function repairContainerCreateFailure(input: {
  readonly apiClient: ContainerCreateApi;
  readonly failure: ContainerMutationSubmitFailure;
  readonly parentContainerId: string;
  readonly parentProjection: ContainerWriterProjectionResponse;
  readonly state: ContainerCreateRepairState;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<ContainerCreateFailureRepair> {
  if (input.stillCurrent?.() === false) {
    return { kind: "unavailable" };
  }
  const repairedPolicy =
    input.state.policyRepairs.take(input.failure.stalePrincipalHeads) &&
    (await recoverPrincipalPolicyRepair({
      heads: input.failure.stalePrincipalHeads,
      organizationId: input.parentProjection.organizationId,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      stillCurrent: input.stillCurrent,
    }));
  if (input.stillCurrent?.() === false) {
    return { kind: "unavailable" };
  }
  if (!repairedPolicy) {
    if (
      input.state.didRepairStaleParent ||
      !isStaleParentContainerPathFailure(input.failure)
    )
      return { kind: "none" };
    input.state.didRepairStaleParent = true;
  }
  // Recovery may select newer policies. Rebuild against a fresh public evidence
  // source so the old projection cannot conflict with newly admitted pins.
  input.apiClient.evictContainerWriterProjection(input.parentContainerId);
  const parentProjection = await input.apiClient.getContainerWriterProjection(
    input.parentContainerId,
  );
  if (input.stillCurrent?.() === false) {
    return { kind: "unavailable" };
  }
  return parentProjection
    ? { kind: "retry", parentProjection }
    : { kind: "unavailable" };
}
