import {
  createProvisionedContainerSeeder,
  type ProvisionedContainerSeeder,
} from "./provisionedContainerSeeds";
import {
  createProvisionedPrincipalHistoryPrimer,
  type ProvisionedPrincipalHistoryPrimer,
  type ProvisionedPrincipalHistoryRuntime,
} from "./provisionedPrincipalHistory";

/**
 * Seeds what a committed provisioning bootstrap already proves: the
 * destination roles of the containers it created and verified recovery
 * progress for its founding policy heads. Each part is bound to the
 * provisioning scope and leaves the online path when it fails.
 */
export type ProvisionedStatePrimer = (
  input: Parameters<ProvisionedContainerSeeder>[0] &
    Parameters<ProvisionedPrincipalHistoryPrimer>[0],
) => Promise<void>;

export function createProvisionedStatePrimer(
  runtime: ProvisionedPrincipalHistoryRuntime,
): ProvisionedStatePrimer {
  const seedContainers = createProvisionedContainerSeeder(runtime);
  const primePrincipalHistory =
    createProvisionedPrincipalHistoryPrimer(runtime);
  return async (input) => {
    await seedContainers(input);
    await primePrincipalHistory(input);
  };
}
