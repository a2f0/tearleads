import { generateKemKeyPair, generateSigningKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createIdentityLink } from "./identityLink";
import { validateLocalUserIdentity } from "./validation";

export const LINK_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const LINK_TRUST_DOMAIN = "https://api.example.test/v1";

export async function identityLinkFixture(seed = 1) {
  const local = {
    signingPublicKey: generateSigningKeyPair(new Uint8Array(32).fill(seed))
      .signingPublicKey,
    encapsulationPublicKey: generateKemKeyPair(new Uint8Array(64).fill(seed))
      .publicKey,
  };
  const identity = await validateLocalUserIdentity({
    candidate: local,
    userId: LINK_USER_ID,
    identityTrustDomain: LINK_TRUST_DOMAIN,
  });
  const remote = {
    userId: identity.userId,
    signingPublicKey: bytesToBase64(identity.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(identity.encapsulationPublicKey),
    signingKeyFingerprint: identity.signingKeyFingerprint,
    encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
  };
  return {
    identity,
    local,
    remote,
    link: await createIdentityLink(identity, "https://app.example.test"),
  };
}
