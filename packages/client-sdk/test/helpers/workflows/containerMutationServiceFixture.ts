import type { SecurityIncidentReporter } from "../../../src/data/shared/securityIncidents";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../src/data/trustedUserIdentity";
import type { ContainerMutationServiceApi } from "../../../src/workflows/containers/containerMutationCollaborators";
import { ContainerMutationService } from "../../../src/workflows/containers/containerMutationService";

const unexpectedIdentityLookup: TrustedUserIdentityResolver = async (
  userId,
) => {
  throw new Error(`Unexpected trusted identity lookup for ${userId}`);
};

/**
 * A service over a fake that implements only the API calls its test path
 * makes; a call it lacks fails as a TypeError, as it did when each mutation
 * took its own API slice. The fake is passed as is, so a test that swaps one
 * of its methods mid-run still reaches the service. Only a share resolves a
 * recipient identity, so a rotation test may leave that resolver out.
 */
export function createContainerMutationServiceFixture(input: {
  readonly api: Partial<ContainerMutationServiceApi>;
  readonly encapsulationSecretKey: Uint8Array;
  readonly execSql: ExecSql;
  readonly reportSecurityIncident?: SecurityIncidentReporter | undefined;
  readonly resolveTrustedUserIdentity?: TrustedUserIdentityResolver | undefined;
}): ContainerMutationService {
  return new ContainerMutationService({
    api: input.api as ContainerMutationServiceApi,
    encapsulationSecretKey: input.encapsulationSecretKey,
    execSql: input.execSql,
    reportSecurityIncident: input.reportSecurityIncident ?? (async () => {}),
    resolveTrustedUserIdentity:
      input.resolveTrustedUserIdentity ?? unexpectedIdentityLookup,
  });
}
