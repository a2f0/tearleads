import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { authenticate } from "./authenticate";
import { buildPrincipalGrantRefreshRequest } from "./containerGrantRefresh";
import { buildRootContainerRekeyMutation } from "./containerRekey";
import { bootstrapRoot } from "./keyingWriterProjectionKit";
import { withGroupMembershipContainerMutations } from "./organizationMembershipGrants";
import {
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "./principalPolicy";
import { registerUser } from "./registerUser";

export async function prepareRotation(
  input: {
    rotateKey?: boolean;
    /** Runs before the rotation is signed, since it may advance the root head. */
    beforeSigning?: (
      owner: ReturnType<typeof createTestUser>,
      root: Awaited<ReturnType<typeof bootstrapRoot>>,
    ) => Promise<Awaited<ReturnType<typeof bootstrapRoot>>>;
  } = {},
) {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const bootstrapped = await bootstrapRoot(owner);
  const root = input.beforeSigning
    ? await input.beforeSigning(owner, bootstrapped)
    : bootstrapped;
  const currentPolicy = root.principalPolicies[0];
  if (!currentPolicy) {
    throw new Error("Expected the root Admins policy");
  }
  const rotatesKey = input.rotateKey ?? true;
  const generatedPrincipalKem = generateKemSeedAndKeyPair();
  const principalKem = rotatesKey
    ? generatedPrincipalKem
    : {
        publicKey: base64ToBytes(currentPolicy.state.encapsulationPublicKey),
        secretKey: generatedPrincipalKem.secretKey,
      };
  const signed = await createSignedPrincipalState({
    principalType: currentPolicy.principalType,
    principalId: currentPolicy.principalId,
    principalKem,
    version: currentPolicy.version + 1,
    prevStateHash: currentPolicy.stateHash,
    keyEpoch: currentPolicy.keyEpoch + (rotatesKey ? 1 : 0),
    members: currentPolicy.projection.map((member) => ({
      userId: member.userId,
    })),
    projection: [...currentPolicy.projection],
    grants: [...currentPolicy.grants],
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const stateHash = await computePrincipalStateHash(signed.state);
  const nextState = {
    ...signed.state,
    stateHash,
    createdAt: signed.state.signedAt,
  };
  const nextPolicy = makeVerifiedPrincipalPolicy({
    principalType: nextState.principalType,
    principalId: nextState.principalId,
    version: nextState.version,
    keyEpoch: nextState.keyEpoch,
    stateHash,
    state: nextState,
    projection: signed.projection,
    grants: signed.grants,
    history: [
      {
        state: currentPolicy.state,
        projection: currentPolicy.projection,
        grants: currentPolicy.grants,
      },
      {
        state: nextState,
        projection: signed.projection,
        grants: signed.grants,
      },
    ],
    checkpoint: {
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash,
    },
  });
  const rootRekey = rotatesKey
    ? await buildRootContainerRekeyMutation({
        previous: root,
        replacementPrincipalPolicy: nextPolicy,
        signer: owner,
      })
    : {
        bundle: root.bundle,
        request: await buildPrincipalGrantRefreshRequest({
          parentKekState: null,
          previous: root.bundle,
          previousContainerPath: [root.bundle],
          previousKekState: root.kekState,
          replacementPrincipalPolicy: nextPolicy,
          signer: owner,
        }),
        kekState: root.kekState,
      };
  const dependentPolicy = await withGroupMembershipContainerMutations({
    actor: owner,
    containerIds: currentPolicy.grants
      .filter((grant) => grant.containerId !== root.kekState.containerId)
      .map((grant) => grant.containerId),
    currentPolicy,
    signedState: signed,
  });
  const metadataMutations = dependentPolicy.containerMutations ?? [];
  if (metadataMutations.length !== 1) {
    throw new Error("Expected exactly one metadata mutation");
  }
  return {
    containerMutations: [rootRekey.request, ...metadataMutations],
    currentPolicy,
    metadataMutations,
    nextPolicy,
    owner,
    root,
    rootRekey,
    signed,
  };
}

export async function putPolicy(
  input: Awaited<ReturnType<typeof prepareRotation>>,
  containerMutations = input.containerMutations,
) {
  return submitOrganizationGroupPolicyCommit({
    actor: input.owner,
    groupId: input.nextPolicy.principalId,
    groupPolicy: {
      state: input.signed.state,
      encryptedPayload: input.signed.encryptedPayload,
      projection: input.signed.projection,
      grants: input.signed.grants,
      memberEnvelopes: input.signed.memberEnvelopes,
      containerMutations,
    },
    organizationId: await getDefaultOrganizationId(input.owner.userId),
  });
}
