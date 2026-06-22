import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import type {
  ProjectionUserKey,
  ProjectionUserKeyResolver,
} from "../keyingProjectionVerification";

interface ProjectionUserKeyRuntime {
  readonly apiClient: {
    getEncapsulationKey(
      userId: string,
    ): Promise<EncapsulationKeyResponse | null>;
  };
  readonly encapsulationKeyPair?: { readonly publicKey: Uint8Array } | null;
  readonly log?: (message: string) => void;
  readonly signingFingerprint?: string | null;
  readonly signingKeyPair?:
    | { readonly signingPublicKey: Uint8Array }
    | null
    | undefined;
  readonly userId?: string | null;
}

export function createProjectionUserKeyResolver(
  runtime: ProjectionUserKeyRuntime,
  logPrefix: string,
): ProjectionUserKeyResolver {
  const cache = new Map<string, Promise<ProjectionUserKey | null>>();
  let ownUserKey: Promise<ProjectionUserKey | null> | null = null;
  let ownUserKeyUserId: string | null = null;
  let ownUserKeySigningFingerprint: string | null | undefined;
  let ownUserKeySigningKeyPair: ProjectionUserKeyRuntime["signingKeyPair"];
  let ownUserKeyEncapsulationKeyPair: ProjectionUserKeyRuntime["encapsulationKeyPair"];

  return async (userId) => {
    if (
      userId === runtime.userId &&
      runtime.signingKeyPair &&
      runtime.encapsulationKeyPair
    ) {
      if (
        !ownUserKey ||
        ownUserKeyUserId !== userId ||
        ownUserKeySigningFingerprint !== runtime.signingFingerprint ||
        ownUserKeySigningKeyPair !== runtime.signingKeyPair ||
        ownUserKeyEncapsulationKeyPair !== runtime.encapsulationKeyPair
      ) {
        const { encapsulationKeyPair, signingKeyPair } = runtime;
        ownUserKey = null;
        ownUserKeyUserId = userId;
        ownUserKeySigningFingerprint = runtime.signingFingerprint;
        ownUserKeySigningKeyPair = signingKeyPair;
        ownUserKeyEncapsulationKeyPair = encapsulationKeyPair;
        ownUserKey = (async () => {
          const signingFingerprint = await toFingerprint(
            signingKeyPair.signingPublicKey,
          );
          if (
            runtime.signingFingerprint &&
            runtime.signingFingerprint !== signingFingerprint
          ) {
            return null;
          }

          return {
            encapsulationPublicKey: encapsulationKeyPair.publicKey,
            signingPublicKey: signingKeyPair.signingPublicKey,
            userId,
          };
        })();
      }

      return ownUserKey;
    }

    let cached = cache.get(userId);
    if (!cached) {
      cached = runtime.apiClient
        .getEncapsulationKey(userId)
        .then(async (response) => {
          if (!response) {
            return null;
          }

          const signingPublicKey = base64ToBytes(response.signingPublicKey);
          const signingKeyFingerprint = await toFingerprint(signingPublicKey);
          if (
            response.userId !== userId ||
            response.signingKeyFingerprint !== signingKeyFingerprint
          ) {
            runtime.log?.(
              `${logPrefix}: skipped projection key for ${userId} because the signing fingerprint does not match the public key.`,
            );
            return null;
          }

          return {
            encapsulationPublicKey: base64ToBytes(
              response.encapsulationPublicKey,
            ),
            signingPublicKey,
            userId,
          };
        })
        .catch(() => {
          runtime.log?.(
            `${logPrefix}: skipped projection key for ${userId} because it could not be loaded.`,
          );
          return null;
        });
      cache.set(userId, cached);
    }

    return cached;
  };
}
