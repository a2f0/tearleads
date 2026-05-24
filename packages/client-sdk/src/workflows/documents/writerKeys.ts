import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import type { DocumentWriterPublicKeyResolver } from "../../data/documents/shared/types";

interface DocumentWriterPublicKeyRuntime {
  apiClient: {
    getEncapsulationKey(
      userId: string,
    ): Promise<EncapsulationKeyResponse | null>;
  };
  log: (message: string) => void;
  signingFingerprint?: string | null | undefined;
  signingKeyPair?:
    | {
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null | undefined;
}

export function createDocumentWriterPublicKeyResolver(input: {
  includeLocalSigningKey?: boolean | undefined;
  logPrefix: string;
  runtime: DocumentWriterPublicKeyRuntime;
  writerKeyLabel: string;
}): DocumentWriterPublicKeyResolver {
  const cache = new Map<string, Promise<Uint8Array | null>>();

  return async ({ authorFingerprint, header }) => {
    if (header.writerKeyFingerprint !== authorFingerprint) {
      return null;
    }

    const localSigningPublicKey =
      input.includeLocalSigningKey === false
        ? undefined
        : input.runtime.signingKeyPair?.signingPublicKey;
    if (header.writerUserId === input.runtime.userId && localSigningPublicKey) {
      const localFingerprint =
        input.runtime.signingFingerprint ??
        (await toFingerprint(localSigningPublicKey));
      return localFingerprint === authorFingerprint
        ? localSigningPublicKey
        : null;
    }

    const cacheKey = `${header.writerUserId}:${authorFingerprint}`;
    let cached = cache.get(cacheKey);
    if (!cached) {
      cached = resolveRemoteWriterPublicKey({
        authorFingerprint,
        logPrefix: input.logPrefix,
        runtime: input.runtime,
        writerKeyLabel: input.writerKeyLabel,
        writerUserId: header.writerUserId,
      });
      cache.set(cacheKey, cached);
    }

    return cached;
  };
}

async function resolveRemoteWriterPublicKey(input: {
  authorFingerprint: string;
  logPrefix: string;
  runtime: DocumentWriterPublicKeyRuntime;
  writerKeyLabel: string;
  writerUserId: string;
}): Promise<Uint8Array | null> {
  try {
    const response = await input.runtime.apiClient.getEncapsulationKey(
      input.writerUserId,
    );
    if (!response) {
      return null;
    }

    const signingPublicKey = base64ToBytes(response.signingPublicKey);
    const signingKeyFingerprint = await toFingerprint(signingPublicKey);
    if (
      signingKeyFingerprint !== response.signingKeyFingerprint ||
      signingKeyFingerprint !== input.authorFingerprint
    ) {
      input.runtime.log(
        `${input.logPrefix}: skipped ${input.writerKeyLabel} for ${input.writerUserId} because the signing fingerprint does not match the public key.`,
      );
      return null;
    }

    return signingPublicKey;
  } catch {
    input.runtime.log(
      `${input.logPrefix}: skipped ${input.writerKeyLabel} for ${input.writerUserId} because it could not be loaded.`,
    );
    return null;
  }
}
