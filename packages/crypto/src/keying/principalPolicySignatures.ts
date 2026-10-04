import { base64ToBytes } from "@tearleads/encoding";
import {
  encodeUnsignedPrincipalState,
  normalizeUnsignedPrincipalState,
  toUnsignedPrincipalState,
} from "../principalState";
import { verifyHistorySignature } from "../signing/verifiedHistorySignature";
import { createSignatureHistoryVerifier } from "../signing/verifiedSignatureHistory";
import { throwVerification } from "./shared";
import type { NormalizedPrincipalPolicyStateChainEntry } from "./types";

const verifyHistory = createSignatureHistoryVerifier();

export async function verifyPrincipalPolicyChainSignatures(input: {
  readonly chain: readonly NormalizedPrincipalPolicyStateChainEntry[];
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<void> {
  const valid = await verifyHistory(async function* () {
    for (const { state } of input.chain) {
      const publicKey = input.signerPublicKeyByUserAndFingerprint.get(
        `${state.signerUserId}:${state.signerUserKeyFingerprint}`,
      );
      if (!publicKey)
        throwVerification(
          "missing_dependency",
          "principal policy signer public key is unavailable",
        );
      const normalized = await normalizeUnsignedPrincipalState(
        toUnsignedPrincipalState(state),
      );
      let signature: Uint8Array;
      try {
        signature = base64ToBytes(state.signature);
      } catch {
        throwVerification(
          "signature_mismatch",
          "principal policy state signature verification failed",
        );
      }
      yield {
        signature,
        message: encodeUnsignedPrincipalState(normalized),
        publicKey,
      };
    }
  });
  if (!valid)
    throwVerification(
      "signature_mismatch",
      "principal policy state signature verification failed",
    );
}

/** Test fixture for complete loss of volatile signature mathematics caches. */
export function clearPrincipalPolicySignatureCaches(): void {
  verifyHistory.clear();
  verifyHistorySignature.clear();
}
