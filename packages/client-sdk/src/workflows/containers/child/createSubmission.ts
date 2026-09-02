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
import { cacheRemoteContainerCreatePolicyRepair } from "./policyRepair";

export interface ContainerCreateRepairState {
  didRepairStaleParent: boolean;
  didRepairStalePolicies: boolean;
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
  if (input.apiClient.createContainerResult) {
    const result = await input.apiClient.createContainerResult(
      input.plan.request,
      { reportErrors: false },
    );
    return result.ok ? { ok: true, response: result.data } : result;
  }
  const response = await input.apiClient.createContainer(input.plan.request);
  return response ? { ok: true, response } : null;
}

export async function repairContainerCreateFailure(input: {
  readonly apiClient: ContainerCreateApi;
  readonly execSql: ExecSql;
  readonly failure: ContainerMutationSubmitFailure;
  readonly parentContainerId: string;
  readonly parentProjection: ContainerWriterProjectionResponse;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly state: ContainerCreateRepairState;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<ContainerCreateFailureRepair> {
  if (input.stillCurrent?.() === false) {
    return { kind: "unavailable" };
  }
  if (
    !input.state.didRepairStalePolicies &&
    (await cacheRemoteContainerCreatePolicyRepair({
      apiClient: input.apiClient,
      execSql: input.execSql,
      failure: input.failure,
      organizationId: input.parentProjection.organizationId,
      reportSecurityIncident: input.reportSecurityIncident,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
      stillCurrent: input.stillCurrent,
    }))
  ) {
    input.state.didRepairStalePolicies = true;
    return { kind: "retry", parentProjection: input.parentProjection };
  }
  if (input.stillCurrent?.() === false) {
    return { kind: "unavailable" };
  }
  if (
    input.state.didRepairStaleParent ||
    !isStaleParentContainerPathFailure(input.failure) ||
    !input.apiClient.evictContainerWriterProjection
  ) {
    return { kind: "none" };
  }
  input.state.didRepairStaleParent = true;
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
