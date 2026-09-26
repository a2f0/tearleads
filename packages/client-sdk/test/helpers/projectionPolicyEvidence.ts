import type {
  PrincipalPolicyBundleResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import type { ContainerMutationAuthor } from "../../src/data/containers/shared/types";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import { policySnapshot } from "./organizationPolicyHistory";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";

export async function createProjectionPolicyEvidence(input: {
  readonly author: ContainerMutationAuthor;
  readonly group: PrincipalPolicyBundleResponse;
  readonly signingPublicKey: Uint8Array;
  readonly encapsulationKeyPair: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  };
}): Promise<ProjectionPolicyEvidenceResponse> {
  const signingKeyPair = {
    signingPrivateKey: input.author.signerPrivateKey,
    signingPublicKey: input.signingPublicKey,
  };
  const members = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      name: "Members",
      groupId: crypto.randomUUID(),
      creatorEncapsulationKeyPair: input.encapsulationKeyPair,
      signerUserId: input.author.signerUserId,
      signingFingerprint: input.author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const organization = await organizationPolicyBundleFromInitialRequest(
    input.author.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: input.group.currentState.principalId,
      memberGroupId: members.currentState.principalId,
      groupHeads: [
        principalPolicyHead(input.group),
        principalPolicyHead(members),
      ],
      organizationId: input.author.organizationId,
      signingKeyPair,
      userId: input.author.signerUserId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    }),
  );
  return {
    organization: policySnapshot(organization),
    organizationPayloads: [organization.currentPayload],
    groups: [policySnapshot(input.group)],
  };
}
