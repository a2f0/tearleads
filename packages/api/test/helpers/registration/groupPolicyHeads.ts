import {
  type ContainerGrantPrincipalHead,
  computePrincipalStateHash,
} from "@tearleads/crypto";
import type {
  CreateOrganizationGroupRequest,
  PrincipalPolicyRef,
} from "@tearleads/validators/request";
import { principalPolicyRef } from "../principalPolicyRefs";

export async function principalHeadFromInitialGroupPolicy(input: {
  adminGroup: CreateOrganizationGroupRequest;
}): Promise<ContainerGrantPrincipalHead> {
  const { initialGroupPolicy } = input.adminGroup;

  return {
    principalType: "group",
    principalId: input.adminGroup.groupId,
    version: initialGroupPolicy.state.version,
    keyEpoch: initialGroupPolicy.state.keyEpoch,
    stateHash: await computePrincipalStateHash(initialGroupPolicy.state),
    keyFingerprint: initialGroupPolicy.state.keyFingerprint,
  };
}

export async function principalPolicyRefFromInitialGroupPolicy(input: {
  adminGroup: CreateOrganizationGroupRequest;
}): Promise<PrincipalPolicyRef> {
  return principalPolicyRef(await principalHeadFromInitialGroupPolicy(input));
}
