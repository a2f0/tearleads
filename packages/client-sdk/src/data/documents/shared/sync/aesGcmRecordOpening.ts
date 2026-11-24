import { createAesGcmIv } from "@tearleads/crypto";

/** The AES-GCM tag WebCrypto appends to every ciphertext. */
const AES_GCM_TAG_BYTES = 16;

/**
 * How opening one record ended. `refused` is AES-GCM refusing the record in
 * a runtime that round-tripped a canary of the record's size under the same
 * key and associated data both before and after refusing it again; `runtime`
 * is any other failure, this runtime's rather than the record's.
 */
type AesGcmRecordOpening =
  | { readonly status: "opened"; readonly plaintext: Uint8Array }
  | { readonly status: "refused"; readonly error: unknown }
  | { readonly status: "runtime"; readonly error: unknown };

/**
 * AES-GCM refusing the record: a failed tag check, or a ciphertext too short
 * to hold one. WebCrypto reports both as `OperationError`, which some engines
 * also use for a backend fault, so a refusal alone does not blame the record.
 */
function isAesGcmAuthenticationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "name") === "OperationError"
  );
}

/** A fixed, non-uniform plaintext, so an engine returning zeros fails it. */
function canaryPlaintext(length: number): Uint8Array<ArrayBuffer> {
  const plaintext = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    plaintext[index] = (index * 31 + 7) & 0xff;
  }
  return plaintext;
}

/**
 * Opens `ciphertext` under `decryptKey`. A first refusal is not trusted: the
 * runtime must seal and open a canary as large as the record's plaintext,
 * the record must be refused again, and a second canary must round-trip
 * after that. Only then is the refusal the record's, which every reader
 * holding the key reaches. The canaries never leave this device.
 *
 * The canary is built only after a refusal, so a record that opens costs no
 * second plaintext-sized buffer, and a failure to build one is the runtime's.
 * `buildCanary` is replaced only by tests that count the builds.
 */
export async function openAesGcmRecord(
  input: {
    readonly additionalData: Uint8Array<ArrayBuffer>;
    readonly ciphertext: Uint8Array<ArrayBuffer>;
    readonly decryptKey: CryptoKey;
    readonly encryptKey: () => Promise<CryptoKey>;
    readonly iv: Uint8Array<ArrayBuffer>;
  },
  buildCanary: (length: number) => Uint8Array<ArrayBuffer> = canaryPlaintext,
): Promise<AesGcmRecordOpening> {
  const algorithm = (iv: Uint8Array<ArrayBuffer>) => ({
    name: "AES-GCM",
    iv,
    additionalData: input.additionalData,
  });
  const open = async (): Promise<AesGcmRecordOpening> => {
    try {
      const plaintext = await crypto.subtle.decrypt(
        algorithm(input.iv),
        input.decryptKey,
        input.ciphertext,
      );
      return { status: "opened", plaintext: new Uint8Array(plaintext) };
    } catch (error) {
      return isAesGcmAuthenticationFailure(error)
        ? { status: "refused", error }
        : { status: "runtime", error };
    }
  };
  let canary: Uint8Array<ArrayBuffer> | undefined;
  let encryptKey: Promise<CryptoKey> | undefined;
  const roundTrip = async (): Promise<AesGcmRecordOpening | undefined> => {
    try {
      canary ??= buildCanary(
        Math.max(0, input.ciphertext.length - AES_GCM_TAG_BYTES),
      );
      const expected = canary;
      encryptKey ??= input.encryptKey();
      const iv = createAesGcmIv();
      const sealed = await crypto.subtle.encrypt(
        algorithm(iv),
        await encryptKey,
        expected,
      );
      const opened = new Uint8Array(
        await crypto.subtle.decrypt(
          algorithm(iv),
          input.decryptKey,
          new Uint8Array(sealed),
        ),
      );
      if (
        opened.length !== expected.length ||
        opened.some((byte, index) => byte !== expected[index])
      ) {
        throw new Error("AES-GCM canary did not round-trip");
      }
      return undefined;
    } catch (error) {
      return { status: "runtime", error };
    }
  };

  const first = await open();
  if (first.status !== "refused") return first;
  const before = await roundTrip();
  if (before) return before;
  const second = await open();
  if (second.status !== "refused") return second;
  return (await roundTrip()) ?? second;
}
