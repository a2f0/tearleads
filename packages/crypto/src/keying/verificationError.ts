export const KEYING_VERIFICATION_CODES = [
  "duplicate_entry",
  "equivocation",
  "hash_mismatch",
  "invalid_domain",
  "invalid_shape",
  "key_epoch_reuse",
  "missing_dependency",
  "object_mismatch",
  "rollback",
  "signature_mismatch",
  "signer_mismatch",
  "stale_citation",
  "stale_predecessor",
  "unauthorized",
] as const;

export type KeyingVerificationCode = (typeof KEYING_VERIFICATION_CODES)[number];

const keyingVerificationCodeSet: ReadonlySet<string> = new Set(
  KEYING_VERIFICATION_CODES,
);

export function isKeyingVerificationCode(
  value: unknown,
): value is KeyingVerificationCode {
  return typeof value === "string" && keyingVerificationCodeSet.has(value);
}

export class KeyingVerificationError extends Error {
  constructor(
    readonly code: KeyingVerificationCode,
    message: string,
  ) {
    super(message);
    this.name = "KeyingVerificationError";
  }
}

export type KeyingVerificationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KeyingVerificationError };
