import type {
  ContainerCreateApi,
  ContainerMoveApi,
  ContainerRekeyApi,
  ContainerRevokeApi,
  ContainerShareApi,
} from "../../data/containers/shared/types";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";

/** The API slices a `ContainerMutationService` calls. */
export type ContainerMutationServiceApi = ContainerCreateApi &
  ContainerShareApi &
  ContainerMoveApi &
  ContainerRekeyApi &
  ContainerRevokeApi;

/**
 * What a `ContainerMutationService` binds for its lifetime, one runtime
 * snapshot: the API client, the executor, and the local identity's
 * encapsulation secret key, so a call never mixes one snapshot's executor with
 * another's key. Feature modules take the slice of `Api` they call.
 */
export interface ContainerMutationCollaborators<
  Api = ContainerMutationServiceApi,
> {
  readonly api: Api;
  /** Unwraps the container key path this identity reaches. */
  readonly encapsulationSecretKey: Uint8Array;
  readonly execSql: ExecSql;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

/** A rotation's collaborators; only a share resolves a recipient identity. */
export type ContainerRotationCollaborators<Api> = Omit<
  ContainerMutationCollaborators<Api>,
  "resolveTrustedUserIdentity"
>;

/** The collaborator fields a rotation threads through its planning and submit. */
export interface ContainerRotationBag<Api> {
  apiClient: Api;
  execSql: ExecSql;
  reportSecurityIncident: SecurityIncidentReporter;
  targetSecretKey: Uint8Array;
}

export function containerRotationBag<Api>(
  collaborators: ContainerRotationCollaborators<Api>,
): ContainerRotationBag<Api> {
  return {
    apiClient: collaborators.api,
    execSql: collaborators.execSql,
    reportSecurityIncident: collaborators.reportSecurityIncident,
    targetSecretKey: collaborators.encapsulationSecretKey,
  };
}
