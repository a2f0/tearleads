import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { createAuthor } from "./containerFixtures";
import { currentGroupMutationInput } from "./currentGroupMutation";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import {
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";

/** A real signature-verified current policy for isolated repair orchestration tests. */
export async function principalRepairEvidence(
  input: Awaited<ReturnType<typeof createAuthor>>,
) {
  const { author, signingPublicKey } = input;
  const bundle = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId: crypto.randomUUID(),
      name: "Repair fixture",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    }),
  );
  const current = await currentGroupMutationInput(bundle, [
    {
      userId: author.signerUserId,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
    },
  ]);
  return {
    head: principalPolicyHead(bundle),
    evidence: {
      organizationId: author.organizationId,
      policy: current.verifiedCurrentPolicy,
      dependencies: [],
      stillCurrent: () => true,
    },
  };
}
