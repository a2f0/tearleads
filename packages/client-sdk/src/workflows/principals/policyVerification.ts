import type { PrincipalPolicySignerPublicKey } from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";

export type PrincipalPolicySignerPublicKeyLoadErrorCode =
  | "fingerprint-mismatch"
  | "not-found";

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

async function loadTrustedSignerPublicKey(input: {
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly state: PrincipalPolicyBundleResponse["currentState"];
}): Promise<
  | { readonly signerPublicKey: PrincipalPolicySignerPublicKey }
  | { readonly error: PrincipalPolicySignerPublicKeyLoadErrorCode }
> {
  const signerKey = await input.resolveTrustedUserIdentity(
    input.state.signerUserId,
  );

  if (!signerKey) {
    return { error: "not-found" };
  }

  if (
    signerKey.signingKeyFingerprint !== input.state.signerUserKeyFingerprint
  ) {
    return { error: "fingerprint-mismatch" };
  }

  return {
    signerPublicKey: {
      userId: input.state.signerUserId,
      signingKeyFingerprint: input.state.signerUserKeyFingerprint,
      signingPublicKey: signerKey.signingPublicKey,
    },
  };
}

export async function collectPrincipalPolicySignerPublicKeys(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<
  | { readonly signerPublicKeys: PrincipalPolicySignerPublicKey[] }
  | { readonly error: PrincipalPolicySignerPublicKeyLoadErrorCode }
> {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  );
  const signerPublicKeysByKey = new Map<
    string,
    PrincipalPolicySignerPublicKey
  >();

  for (const state of principalPolicyStates(input.bundle)) {
    const cacheKey = signerCacheKey({
      signerUserId: state.signerUserId,
      signingFingerprint: state.signerUserKeyFingerprint,
    });
    if (signerPublicKeysByKey.has(cacheKey)) {
      continue;
    }

    const remoteSignerPublicKey = await loadTrustedSignerPublicKey({
      resolveTrustedUserIdentity,
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
