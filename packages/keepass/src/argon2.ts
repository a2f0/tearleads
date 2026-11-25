import { argon2d, argon2id } from "hash-wasm";
import { CryptoEngine } from "kdbxweb";

const ARGON2_VERSION_13 = 0x13;

/**
 * kdbxweb leaves Argon2 (the KDBX 4 key derivation) to its host. hash-wasm
 * runs it in WebAssembly, fast enough for KeePassXC's default 64 MiB cost.
 * kdbxweb passes memory in KiB, as hash-wasm expects.
 */
export const kdbxArgon2: CryptoEngine.Argon2Fn = async (
  password,
  salt,
  memory,
  iterations,
  length,
  parallelism,
  type,
  version,
) => {
  // hash-wasm implements only Argon2 1.3, which every KDBX 4 writer uses.
  if (version !== ARGON2_VERSION_13) {
    throw new Error(`Unsupported Argon2 version 0x${version.toString(16)}.`);
  }
  const options = {
    hashLength: length,
    iterations,
    memorySize: memory,
    outputType: "binary",
    parallelism,
    password: new Uint8Array(password),
    salt: new Uint8Array(salt),
  } as const;
  const hash =
    type === CryptoEngine.Argon2TypeArgon2id
      ? await argon2id(options)
      : await argon2d(options);
  return hash.slice().buffer;
};

let installed = false;

export function installArgon2(): void {
  if (installed) return;
  CryptoEngine.setArgon2Impl(kdbxArgon2);
  installed = true;
}
