import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signOrganizationReplacementAuthorization,
  verifyOrganizationReplacementAuthorization,
} from "@tearleads/crypto";
import { buildOrganizationProvisioningArtifacts } from "../../src/workflows/registration/registerIdentity";

export async function createReplacementAuthorizationFixture() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const rootContainerId = crypto.randomUUID();
  const artifacts = await buildOrganizationProvisioningArtifacts({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    rootContainerId,
    signingKeyPair,
    userId,
  });
  const input = {
    ...artifacts,
    replacesOrganizationId: String(crypto.randomUUID()),
    rootContainerId,
    userId,
  };
  const authorization = verifyOrganizationReplacementAuthorization(
    await signOrganizationReplacementAuthorization(input, signingKeyPair),
    signingKeyPair.signingPublicKey,
  );
  return { input, signingKeyPair, authorization };
}
