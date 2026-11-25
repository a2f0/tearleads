import { Buffer } from "node:buffer";
import { createHmac, hkdfSync, randomBytes } from "node:crypto";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
/** 30 characters with no 0/o, 1/i/l, or u, so a code reads back unambiguously. */
const RECOVERY_CODE_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

const HASH_DOMAIN = "tearleads.two-factor-recovery-code.v1";

/** Whose codes are hashed, and the server secret their hash key derives from. */
export interface RecoveryCodeScope {
  readonly serverSecret: string;
  readonly userId: string;
}

let derived: { readonly secret: string; readonly key: Buffer } | undefined;

function hashKey(serverSecret: string): Buffer {
  if (derived?.secret !== serverSecret) {
    derived = {
      key: Buffer.from(
        hkdfSync("sha256", serverSecret, Buffer.alloc(0), HASH_DOMAIN, 32),
      ),
      secret: serverSecret,
    };
  }
  return derived.key;
}

/**
 * A keyed hash bound to the user: a database read alone cannot test guesses,
 * and one guess never tests every user's codes at once.
 */
function keyedHash(code: string, scope: RecoveryCodeScope): string {
  return createHmac("sha256", hashKey(scope.serverSecret))
    .update(`${scope.userId}:${code}`)
    .digest("hex");
}

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
export function generateRecoveryCodes(scope: RecoveryCodeScope): {
  readonly codes: readonly string[];
  readonly hashes: readonly string[];
} {
  const codes: string[] = [];
  const hashes = new Set<string>();
  while (codes.length < RECOVERY_CODE_COUNT) {
    const code = randomRecoveryCode();
    const hash = keyedHash(code, scope);
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
export function recoveryCodeHash(
  raw: string,
  scope: RecoveryCodeScope,
): string | null {
  const code = raw.toLowerCase().replace(/[\s-]/g, "");
  if (code.length !== RECOVERY_CODE_LENGTH) return null;
  for (const character of code) {
    if (!RECOVERY_CODE_ALPHABET.includes(character)) return null;
  }
  return keyedHash(code, scope);
}
