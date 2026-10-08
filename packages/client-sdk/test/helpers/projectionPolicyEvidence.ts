import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ContainerMutationAuthor } from "../../src/data/containers/shared/types";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
} from "./projectionPolicyHistory";

export async function createProjectionPolicyEvidence(input: {
  readonly author: ContainerMutationAuthor;
  readonly group: PrincipalPolicyBundleResponse;
  readonly admins?: PrincipalPolicyBundleResponse;
  readonly signingPublicKey: Uint8Array;
  readonly encapsulationKeyPair: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  };
}) {
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
  const admins =
    input.admins ??
    (await policyBundleFromInitialRequest(
      await buildInitialGroupPolicyRequest({
        name: "Admins",
        groupId: crypto.randomUUID(),
        creatorEncapsulationKeyPair: input.encapsulationKeyPair,
        signerUserId: input.author.signerUserId,
        signingFingerprint: input.author.signerKeyFingerprint,
        signingKeyPair,
      }),
    ));
  const organization = await organizationPolicyBundleFromInitialRequest(
    input.author.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: admins.currentState.principalId,
      memberGroupId: members.currentState.principalId,
      groupHeads: [
        principalPolicyHead(input.group),
        principalPolicyHead(admins),
        principalPolicyHead(members),
      ],
      organizationId: input.author.organizationId,
      signingKeyPair,
      userId: input.author.signerUserId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    }),
  );
  return {
    bundles: [organization, admins, input.group],
    policyEvidence: {
      organization: projectionPolicySource(organization),
      organizationPayloads: [projectionDirectoryPayload(organization)],
      groups: [
        projectionPolicySource(admins),
        projectionPolicySource(input.group),
      ],
    },
  };
}
