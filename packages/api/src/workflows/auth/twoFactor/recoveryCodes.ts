import { randomBytes } from "node:crypto";
import { sha256Hex } from "../../../utils/sha256";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
/** 30 characters with no 0/o, 1/i/l, or u, so a code reads back unambiguously. */
const RECOVERY_CODE_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

function randomRecoveryCode(): string {
  // Rejection sampling keeps each character uniform over the alphabet.
  const limit = 256 - (256 % RECOVERY_CODE_ALPHABET.length);
  let code = "";
  while (code.length < RECOVERY_CODE_LENGTH) {
    for (const byte of randomBytes(RECOVERY_CODE_LENGTH)) {
      if (byte < limit && code.length < RECOVERY_CODE_LENGTH) {
        code += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length];
      }
    }
  }
  return code;
}

/** Ten new codes formatted `xxxxx-xxxxx`, with the hashes to store. */
export function generateRecoveryCodes(): {
  readonly codes: readonly string[];
  readonly hashes: readonly string[];
} {
  const codes: string[] = [];
  const hashes = new Set<string>();
  while (codes.length < RECOVERY_CODE_COUNT) {
    const code = randomRecoveryCode();
    const hash = sha256Hex(code);
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    const half = RECOVERY_CODE_LENGTH / 2;
    codes.push(`${code.slice(0, half)}-${code.slice(half)}`);
  }
  return { codes, hashes: [...hashes] };
}

/**
 * The stored hash of a typed recovery code, or null when it cannot be one.
 * Case, spaces, and dashes are ignored.
 */
export function recoveryCodeHash(raw: string): string | null {
  const code = raw.toLowerCase().replace(/[\s-]/g, "");
  if (code.length !== RECOVERY_CODE_LENGTH) return null;
  for (const character of code) {
    if (!RECOVERY_CODE_ALPHABET.includes(character)) return null;
  }
  return sha256Hex(code);
}
