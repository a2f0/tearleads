import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";

const DOMAIN = "tearleads.two-factor-secret.v1";
const SEALED_PREFIX = "v1";
const IV_BYTES = 12;

let derived:
  | { readonly secret: string; readonly key: Promise<CryptoKey> }
  | undefined;

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

/** An AES-256-GCM key derived from the server secret under its own label. */
function sealingKey(serverSecret: string): Promise<CryptoKey> {
  if (derived?.secret === serverSecret) return derived.key;
  const key = crypto.subtle
    .importKey("raw", utf8(serverSecret), "HKDF", false, ["deriveKey"])
    .then((base) =>
      crypto.subtle.deriveKey(
        {
          hash: "SHA-256",
          info: utf8(DOMAIN),
          name: "HKDF",
          salt: new Uint8Array(0),
        },
        base,
        { length: 256, name: "AES-GCM" },
        false,
        ["decrypt", "encrypt"],
      ),
    );
  derived = { key, secret: serverSecret };
  return key;
}

/** Binds a sealed secret to its user, so a row copied to another user fails. */
function additionalData(userId: string): Uint8Array<ArrayBuffer> {
  return utf8(`${DOMAIN}:${userId}`);
}

export async function sealTwoFactorSecret(input: {
  readonly secret: Uint8Array;
  readonly serverSecret: string;
  readonly userId: string;
}): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { additionalData: additionalData(input.userId), iv, name: "AES-GCM" },
    await sealingKey(input.serverSecret),
    new Uint8Array(input.secret),
  );
  return [
    SEALED_PREFIX,
    bytesToBase64(iv),
    bytesToBase64(new Uint8Array(ciphertext)),
  ].join(".");
}

/** Throws when the value is malformed or was sealed for another user or key. */
export async function openTwoFactorSecret(input: {
  readonly sealed: string;
  readonly serverSecret: string;
  readonly userId: string;
}): Promise<Uint8Array> {
  const [prefix, iv, ciphertext, ...rest] = input.sealed.split(".");
  if (prefix !== SEALED_PREFIX || !iv || !ciphertext || rest.length > 0) {
    throw new Error("Malformed two-factor secret");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: additionalData(input.userId),
      iv: new Uint8Array(base64ToBytes(iv)),
      name: "AES-GCM",
    },
    await sealingKey(input.serverSecret),
    new Uint8Array(base64ToBytes(ciphertext)),
  );
  return new Uint8Array(plaintext);
}
