import { base64ToBytes } from "@tearleads/encoding";
import {
  loadTrustedUserIdentityPin,
  type TrustedUserIdentityPinProvenance,
} from "../persistence/trustedUserIdentityPinPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { brandTrustedUserIdentity, type TrustedUserIdentity } from "./types";
import {
  assertTrustedUserIdentityUserId,
  validateUserIdentityKeys,
} from "./validation";

/**
 * Read-only: the identity this trust store already pins for `userId` and how
 * it was established, or null. The stored keys must still match their stored
 * fingerprints. Never inserts, compares against or replaces a pin.
 */
export async function loadPin(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly userId: string;
}): Promise<{
  readonly identity: TrustedUserIdentity;
  readonly provenance: TrustedUserIdentityPinProvenance;
} | null> {
  assertTrustedUserIdentityUserId(input.userId);
  const pin = await loadTrustedUserIdentityPin(input);
  if (!pin) return null;
  const keys = await validateUserIdentityKeys({
    candidate: {
      encapsulationPublicKey: base64ToBytes(pin.encapsulationPublicKey),
      signingKeyFingerprint: pin.signingKeyFingerprint,
      signingPublicKey: base64ToBytes(pin.signingPublicKey),
    },
    encapsulationKeyFingerprint: pin.encapsulationKeyFingerprint,
  });
  return {
    identity: brandTrustedUserIdentity({
      ...keys,
      identityTrustDomain: input.identityTrustDomain,
      userId: input.userId,
    }),
    provenance: pin.provenance,
  };
}

/** Read-only: the pinned identity for `userId` of any provenance, or null. */
export async function loadPinnedUserIdentity(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly userId: string;
}): Promise<TrustedUserIdentity | null> {
  return (await loadPin(input))?.identity ?? null;
}
