import { KeyingVerificationError } from "@symcrypt/crypto";
import type { DocumentWriterPublicKeyResolver } from "../../data/documents/shared/types";
import { isDatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";

interface DocumentWriterPublicKeyRuntime {
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly util: {
    readonly log: (message: string) => void;
  };
}

export function createDocumentWriterPublicKeyResolver(input: {
  readonly logPrefix: string;
  readonly runtime: DocumentWriterPublicKeyRuntime;
  readonly writerKeyLabel: string;
}): DocumentWriterPublicKeyResolver {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.runtime.resolveTrustedUserIdentity,
  );
  const cache = new Map<string, Promise<Uint8Array | null>>();

  return async ({ writerSigningKeyFingerprint, writerUserId }) => {
    const cacheKey = `${writerUserId}:${writerSigningKeyFingerprint}`;
    let cached = cache.get(cacheKey);
    if (!cached) {
      cached = resolveWriterPublicKey({
        authorFingerprint: writerSigningKeyFingerprint,
        logPrefix: input.logPrefix,
        resolveTrustedUserIdentity,
        util: input.runtime.util,
        writerKeyLabel: input.writerKeyLabel,
        writerUserId,
      }).catch((error: unknown) => {
        cache.delete(cacheKey);
        throw error;
      });
      cache.set(cacheKey, cached);
    }

    return cached;
  };
}

async function resolveWriterPublicKey(input: {
  readonly authorFingerprint: string;
  readonly logPrefix: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly util: DocumentWriterPublicKeyRuntime["util"];
  readonly writerKeyLabel: string;
  readonly writerUserId: string;
}): Promise<Uint8Array | null> {
  try {
    const identity = await input.resolveTrustedUserIdentity(input.writerUserId);
    if (!identity) {
      return null;
    }

    if (identity.signingKeyFingerprint !== input.authorFingerprint) {
      input.util.log(
        `${input.logPrefix}: skipped ${input.writerKeyLabel} for ${input.writerUserId} because the signing fingerprint does not match the writer.`,
      );
      return null;
    }

    return identity.signingPublicKey;
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    // A vanished database is infrastructure loss, not an unresolvable writer.
    // Returning null here would surface downstream as a generic "writer public
    // key missing" verification error that sync lanes cannot classify, so the
    // lane would count a real failure for a routine runtime swap. Rethrow and
    // let the lanes' shouldIgnoreError treat it as the benign signal it is.
    if (isDatabaseUnavailableError(error)) {
      throw error;
    }
    input.util.log(
      `${input.logPrefix}: skipped ${input.writerKeyLabel} for ${input.writerUserId} because it could not be loaded.`,
    );
    return null;
  }
}
