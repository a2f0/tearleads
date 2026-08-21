import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import {
  assertEnvelopeContextMatches,
  assertWrappedLocalSecretEnvelope,
} from "./envelope";
import { copyBytes, randomBytes } from "./primitives";
import { localSecretAdditionalData } from "./scope";
import {
  type LocalSecretContext,
  WRAPPED_LOCAL_SECRET_FORMAT,
  type WrappedLocalSecretEnvelope,
  type WrappingKeyHandle,
} from "./types";

const AES_GCM_IV_BYTES = 12;
const AES_GCM_WRAPPING_ALGORITHM = "aes-256-gcm";

/**
 * Resolves the AES-GCM key a keystore holds for `keyId`, or `null` when the
 * keystore no longer has it. Keystores differ only in where the key lives
 * (IndexedDB record, in-memory map), not in how the envelope is sealed.
 */
type WrappingKeyResolver = (
  keyId: string,
) => CryptoKey | null | Promise<CryptoKey | null>;

/**
 * Validates an envelope against the unwrapping keystore's context, provider,
 * and AES-GCM algorithm, and returns its required base64 IV. Shared by every
 * AES-GCM-sealing keystore so the checks and error messages stay identical.
 */
export function assertUnwrappableAesGcmEnvelope(input: {
  readonly algorithm: string;
  readonly context: LocalSecretContext;
  readonly envelope: WrappedLocalSecretEnvelope;
  readonly provider: string;
}): string {
  const { envelope } = input;
  assertWrappedLocalSecretEnvelope(envelope);
  assertEnvelopeContextMatches({
    actual: envelope.context,
    expected: input.context,
  });
  if (envelope.provider !== input.provider) {
    throw new Error("Wrapped local secret provider is unsupported.");
  }
  if (envelope.algorithm !== input.algorithm) {
    throw new Error("Wrapped local secret algorithm is unsupported.");
  }
  if (!envelope.iv) {
    throw new Error("Wrapped local secret IV is required.");
  }
  return envelope.iv;
}

/** Builds the sealed envelope literal every AES-GCM keystore persists. */
export function sealAesGcmEnvelope(input: {
  readonly algorithm: string;
  readonly ciphertext: Uint8Array;
  readonly context: LocalSecretContext;
  readonly iv: Uint8Array;
  readonly keyId: string;
  readonly provider: string;
}): WrappedLocalSecretEnvelope {
  return {
    algorithm: input.algorithm,
    ciphertext: bytesToBase64(input.ciphertext),
    context: input.context,
    format: WRAPPED_LOCAL_SECRET_FORMAT,
    iv: bytesToBase64(input.iv),
    keyId: input.keyId,
    provider: input.provider,
    version: 1,
    wrappedAt: new Date().toISOString(),
  };
}

export async function unwrapAesGcmSecret(input: {
  readonly context: LocalSecretContext;
  readonly envelope: WrappedLocalSecretEnvelope;
  readonly provider: string;
  readonly resolveKey: WrappingKeyResolver;
}): Promise<Uint8Array<ArrayBuffer>> {
  const { context, envelope } = input;
  const iv = assertUnwrappableAesGcmEnvelope({
    algorithm: AES_GCM_WRAPPING_ALGORITHM,
    context,
    envelope,
    provider: input.provider,
  });

  const key = await input.resolveKey(envelope.keyId);
  if (!key) {
    throw new Error("Wrapping key is unavailable.");
  }

  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          additionalData: localSecretAdditionalData(context),
          iv: copyBytes(base64ToBytes(iv)),
          name: "AES-GCM",
        },
        key,
        copyBytes(base64ToBytes(envelope.ciphertext)),
      ),
    );
  } catch (error) {
    throw new Error("Wrapped local secret could not be unwrapped.", {
      cause: error,
    });
  }
}

export async function wrapAesGcmSecret(input: {
  readonly context: LocalSecretContext;
  readonly handle: WrappingKeyHandle;
  readonly plaintext: Uint8Array;
  readonly provider: string;
  readonly resolveKey: WrappingKeyResolver;
}): Promise<WrappedLocalSecretEnvelope> {
  const { context, handle } = input;
  if (handle.provider !== input.provider) {
    throw new Error("Wrapping key handle provider is unsupported.");
  }
  const key = await input.resolveKey(handle.keyId);
  if (!key) {
    throw new Error("Wrapping key is unavailable.");
  }
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        additionalData: localSecretAdditionalData(context),
        iv,
        name: "AES-GCM",
      },
      key,
      copyBytes(input.plaintext),
    ),
  );

  return sealAesGcmEnvelope({
    algorithm: AES_GCM_WRAPPING_ALGORITHM,
    ciphertext,
    context,
    iv,
    keyId: handle.keyId,
    provider: input.provider,
  });
}
