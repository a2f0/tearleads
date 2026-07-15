import {
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";

export type PrincipalPolicySignerPublicKeyLoadErrorCode =
  | "fingerprint-invalid"
  | "fingerprint-mismatch"
  | "not-found"
  | "user-mismatch";

interface TrustedPrincipalPolicySignerPublicKey {
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

export function principalPolicyStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

function signerCacheKey(input: {
  readonly signerUserId: string;
  readonly signingFingerprint: string;
}): string {
  return `${input.signerUserId}:${input.signingFingerprint}`;
}

async function trustedSignerPublicKeysByKey(input: {
  readonly trustedSignerPublicKeys:
    | readonly TrustedPrincipalPolicySignerPublicKey[]
    | undefined;
}): Promise<Map<string, PrincipalPolicySignerPublicKey>> {
  const trustedSignerPublicKeysByKey = new Map<
    string,
    PrincipalPolicySignerPublicKey
  >();

  for (const trustedSigner of input.trustedSignerPublicKeys ?? []) {
    if (trustedSignerPublicKeysByKey.has(signerCacheKey(trustedSigner))) {
      continue;
    }

    if (
      (await toFingerprint(trustedSigner.signingPublicKey)) !==
      trustedSigner.signingFingerprint
    ) {
      continue;
    }

    trustedSignerPublicKeysByKey.set(signerCacheKey(trustedSigner), {
      userId: trustedSigner.signerUserId,
      signingKeyFingerprint: trustedSigner.signingFingerprint,
      signingPublicKey: trustedSigner.signingPublicKey,
    });
  }

  return trustedSignerPublicKeysByKey;
}

async function loadRemoteSignerPublicKey(input: {
  readonly getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
  readonly state: PrincipalPolicyBundleResponse["currentState"];
}): Promise<
  | { readonly signerPublicKey: PrincipalPolicySignerPublicKey }
  | { readonly error: PrincipalPolicySignerPublicKeyLoadErrorCode }
> {
  const signerKey = await input.getEncapsulationKey(input.state.signerUserId);

  if (!signerKey) {
    return { error: "not-found" };
  }

  if (signerKey.userId !== input.state.signerUserId) {
    return { error: "user-mismatch" };
  }

  if (
    signerKey.signingKeyFingerprint !== input.state.signerUserKeyFingerprint
  ) {
    return { error: "fingerprint-mismatch" };
  }

  const signingPublicKey = base64ToBytes(signerKey.signingPublicKey);
  if (
    (await toFingerprint(signingPublicKey)) !==
    input.state.signerUserKeyFingerprint
  ) {
    return { error: "fingerprint-invalid" };
  }

  return {
    signerPublicKey: {
      userId: input.state.signerUserId,
      signingKeyFingerprint: input.state.signerUserKeyFingerprint,
      signingPublicKey,
    },
  };
}

export async function collectPrincipalPolicySignerPublicKeys(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
  readonly trustedSignerPublicKeys?:
    | readonly TrustedPrincipalPolicySignerPublicKey[]
    | undefined;
}): Promise<
  | { readonly signerPublicKeys: PrincipalPolicySignerPublicKey[] }
  | { readonly error: PrincipalPolicySignerPublicKeyLoadErrorCode }
> {
  const signerPublicKeysByKey = new Map<
    string,
    PrincipalPolicySignerPublicKey
  >();
  const trustedSignerPublicKeys = await trustedSignerPublicKeysByKey({
    trustedSignerPublicKeys: input.trustedSignerPublicKeys,
  });

  for (const state of principalPolicyStates(input.bundle)) {
    const cacheKey = signerCacheKey({
      signerUserId: state.signerUserId,
      signingFingerprint: state.signerUserKeyFingerprint,
    });
    if (signerPublicKeysByKey.has(cacheKey)) {
      continue;
    }

    const trustedSignerPublicKey = trustedSignerPublicKeys.get(cacheKey);
    if (trustedSignerPublicKey) {
      signerPublicKeysByKey.set(cacheKey, trustedSignerPublicKey);
      continue;
    }

    const remoteSignerPublicKey = await loadRemoteSignerPublicKey({
      getEncapsulationKey: input.getEncapsulationKey,
      state,
    });
    if ("error" in remoteSignerPublicKey) {
      return { error: remoteSignerPublicKey.error };
    }

    signerPublicKeysByKey.set(cacheKey, remoteSignerPublicKey.signerPublicKey);
  }

  return {
    signerPublicKeys: Array.from(signerPublicKeysByKey.values()),
  };
}
