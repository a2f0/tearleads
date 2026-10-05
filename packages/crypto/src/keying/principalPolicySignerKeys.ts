import { toFingerprint } from "../fingerprint";
import { throwVerification } from "./shared";
import type { PrincipalPolicySignerPublicKey } from "./types";

function normalizePrincipalPolicySignerKey(
  signerKey: PrincipalPolicySignerPublicKey,
): PrincipalPolicySignerPublicKey {
  if (signerKey.userId.length === 0) {
    throwVerification("invalid_shape", "principal policy signer user missing");
  }

  if (!/^[0-9a-f]{64}$/.test(signerKey.signingKeyFingerprint)) {
    throwVerification(
      "hash_mismatch",
      "principal policy signer fingerprint must be a 64-character lowercase hex hash",
    );
  }

  if (signerKey.signingPublicKey.length === 0) {
    throwVerification(
      "invalid_shape",
      "principal policy signer public key missing",
    );
  }

  return signerKey;
}

export async function buildPrincipalPolicySignerKeyMap(
  signerPublicKeys: readonly PrincipalPolicySignerPublicKey[],
): Promise<Map<string, Uint8Array>> {
  const signerPublicKeyByUserAndFingerprint = new Map<string, Uint8Array>();

  for (const signerKey of signerPublicKeys.map(
    normalizePrincipalPolicySignerKey,
  )) {
    const computedFingerprint = await toFingerprint(signerKey.signingPublicKey);

    if (computedFingerprint !== signerKey.signingKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "principal policy signer key fingerprint does not match public key",
      );
    }

    const key = `${signerKey.userId}:${signerKey.signingKeyFingerprint}`;
    if (signerPublicKeyByUserAndFingerprint.has(key)) {
      throwVerification(
        "duplicate_entry",
        "principal policy signer key list contains a duplicate",
      );
    }

    signerPublicKeyByUserAndFingerprint.set(key, signerKey.signingPublicKey);
  }

  return signerPublicKeyByUserAndFingerprint;
}
