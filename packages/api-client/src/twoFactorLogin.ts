import type { TwoFactorLoginCode } from "@tearleads/validators/request";
import {
  VERIFY_ERROR_CODES,
  type VerifyErrorCode,
} from "@tearleads/validators/response";

/** What sign-in sends for an identity with two-factor turned on. */
export interface LoginSecondFactor {
  /** A typed authenticator or recovery code. */
  readonly twoFactor?: TwoFactorLoginCode | undefined;
  /** A token this device was given when it asked to be remembered. */
  readonly twoFactorDeviceToken?: string | undefined;
}

export type TwoFactorLoginErrorCode = Extract<
  VerifyErrorCode,
  "two_factor_invalid" | "two_factor_locked" | "two_factor_required"
>;

const twoFactorLoginCodes: ReadonlySet<string> =
  new Set<TwoFactorLoginErrorCode>([
    VERIFY_ERROR_CODES.twoFactorInvalid,
    VERIFY_ERROR_CODES.twoFactorLocked,
    VERIFY_ERROR_CODES.twoFactorRequired,
  ]);

export function isTwoFactorLoginErrorCode(
  code: string | undefined,
): code is TwoFactorLoginErrorCode {
  return code !== undefined && twoFactorLoginCodes.has(code);
}

/**
 * Sign-in needs a second factor: none was sent or the remembered device was
 * forgotten (`two_factor_required`), the code did not match
 * (`two_factor_invalid`), or too many codes missed (`two_factor_locked`).
 * Silent renewal cannot answer it, so callers ask the person.
 */
export class TwoFactorLoginError extends Error {
  override readonly name = "TwoFactorLoginError";

  constructor(readonly code: TwoFactorLoginErrorCode) {
    super(
      code === VERIFY_ERROR_CODES.twoFactorLocked
        ? "Too many invalid two-factor codes; try again later."
        : code === VERIFY_ERROR_CODES.twoFactorInvalid
          ? "That two-factor code did not match."
          : "A two-factor code is required.",
    );
  }
}
