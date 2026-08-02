import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
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

export async function unwrapAesGcmSecret(input: {
  readonly context: LocalSecretContext;
  readonly envelope: WrappedLocalSecretEnvelope;
  readonly provider: string;
  readonly resolveKey: WrappingKeyResolver;
}): Promise<Uint8Array<ArrayBuffer>> {
  const { context, envelope } = input;
  assertWrappedLocalSecretEnvelope(envelope);
  assertEnvelopeContextMatches({
    actual: envelope.context,
    expected: context,
  });
  if (envelope.provider !== input.provider) {
    throw new Error("Wrapped local secret provider is unsupported.");
  }
  if (envelope.algorithm !== AES_GCM_WRAPPING_ALGORITHM) {
    throw new Error("Wrapped local secret algorithm is unsupported.");
  }
  if (!envelope.iv) {
    throw new Error("Wrapped local secret IV is required.");
  }

  const key = await input.resolveKey(envelope.keyId);
  if (!key) {
    throw new Error("Wrapping key is unavailable.");
  }

  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          additionalData: localSecretAdditionalData(context),
          iv: copyBytes(base64ToBytes(envelope.iv)),
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

  return {
    algorithm: AES_GCM_WRAPPING_ALGORITHM,
    ciphertext: bytesToBase64(ciphertext),
    context,
    format: WRAPPED_LOCAL_SECRET_FORMAT,
    iv: bytesToBase64(iv),
    keyId: handle.keyId,
    provider: input.provider,
    version: 1,
    wrappedAt: new Date().toISOString(),
  };
}
