import {
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";

/** Check the private material as well as the public key embedded in an ML-KEM key. */
export async function principalSecretKeyMatchesState(
  secretKey: Uint8Array,
  state: {
    readonly encapsulationPublicKey: string;
    readonly keyFingerprint: string;
  },
): Promise<boolean> {
  try {
    const publicKey = base64ToBytes(state.encapsulationPublicKey);
    if ((await toFingerprint(publicKey)) !== state.keyFingerprint) return false;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapDekForRecipients(challenge, [publicKey]);
    const recovered = await unwrapDek(wrapped, secretKey);
    return (
      recovered.length === challenge.length &&
      recovered.every((byte, index) => byte === challenge[index])
    );
  } catch {
    return false;
  }
}
