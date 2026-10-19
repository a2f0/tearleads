import type { ContainerGrantPrincipalHead } from "@tearleads/crypto";
import { computePrincipalStateHash } from "@tearleads/crypto";
import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";

type InitialManagedPrincipalPolicy =
  CreateOrganizationGroupRequest["initialGroupPolicy"];

interface RootManagedPrincipalGrantInput {
  readonly principalId: string;
  readonly policy: InitialManagedPrincipalPolicy;
}

export async function principalHeadFromInitialGroupPolicy(
  input: RootManagedPrincipalGrantInput,
): Promise<ContainerGrantPrincipalHead> {
  return {
    principalType: "group",
    principalId: input.principalId,
    version: input.policy.state.version,
    keyEpoch: input.policy.state.keyEpoch,
    stateHash: await computePrincipalStateHash(input.policy.state),
    keyFingerprint: input.policy.state.keyFingerprint,
  };
}
