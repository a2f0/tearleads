import { bytesToBase64 } from "@tearleads/encoding";

// Process-local, non-extractable key: tokens cannot be correlated across runs.
let tokenKey: Promise<CryptoKey> | undefined;
const domain = new TextEncoder().encode("tearleads.container-kek.cache.v1\0");

/** A cache discriminator, never an epoch commitment or a retained KEK. */
export async function containerKekCacheToken(
  keyMaterial: Uint8Array,
): Promise<string> {
  const input = new Uint8Array(domain.length + keyMaterial.length);
  input.set(domain);
  input.set(keyMaterial, domain.length);
  try {
    tokenKey ??= crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    );
    const token = new Uint8Array(
      await crypto.subtle.sign("HMAC", await tokenKey, input),
    );
    try {
      return bytesToBase64(token);
    } finally {
      token.fill(0);
    }
  } finally {
    input.fill(0);
  }
}
