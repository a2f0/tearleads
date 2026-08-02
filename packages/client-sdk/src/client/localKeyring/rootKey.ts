import { copyBytes } from "./primitives";
import {
  localKeyringSalt,
  localSecretAdditionalData,
  localSecretContext,
} from "./scope";
import type { LocalKeyPurpose, NormalizedLocalKeyringScope } from "./types";

export const LOCAL_ROOT_KEY_BYTES = 32;

async function importHkdfRootKey(rootKey: Uint8Array): Promise<CryptoKey> {
  if (rootKey.byteLength !== LOCAL_ROOT_KEY_BYTES) {
    throw new Error("Local keyring root key must be 32 bytes.");
  }

  return crypto.subtle.importKey("raw", copyBytes(rootKey), "HKDF", false, [
    "deriveBits",
  ]);
}

export async function deriveLocalSecretKey(input: {
  readonly purpose: LocalKeyPurpose;
  readonly rootKey: Uint8Array;
  readonly scope: NormalizedLocalKeyringScope;
}): Promise<Uint8Array<ArrayBuffer>> {
  const rootCryptoKey = await importHkdfRootKey(input.rootKey);
  const bits = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      info: localSecretAdditionalData(
        localSecretContext(input.scope, input.purpose),
      ),
      name: "HKDF",
      salt: localKeyringSalt(input.scope),
    },
    rootCryptoKey,
    256,
  );

  return new Uint8Array(bits);
}
