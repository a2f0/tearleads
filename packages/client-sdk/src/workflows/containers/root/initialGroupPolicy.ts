import type {
  ContainerGrantPrincipalHead,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { computePrincipalStateHash } from "@tearleads/crypto";
import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import { readCanonicalRecord } from "../../../data/keyingCanonicalJson";

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

export function principalPolicyRecordFromInitialGroupPolicy(input: {
  readonly head: ReferencedPrincipalHead;
  readonly policy: InitialManagedPrincipalPolicy;
}): Record<string, unknown> {
  const { head } = input;

  return readCanonicalRecord(
    {
      principalType: head.principalType,
      principalId: head.principalId,
      version: head.version,
      keyEpoch: head.keyEpoch,
      stateHash: head.stateHash,
      state: {
        ...input.policy.state,
        stateHash: head.stateHash,
      },
      projection: input.policy.projection,
      grants: input.policy.grants,
      checkpoint: {
        principalType: head.principalType,
        principalId: head.principalId,
        version: head.version,
        stateHash: head.stateHash,
      },
    },
    "Initial managed principal policy",
  );
}
