import { VERIFY_ERROR_CODES } from "@tearleads/validators/response";
import type { RequestResult } from "./types";

/**
 * Sign-in was refused because a platform operator suspended the account. It
 * is terminal: renewing the session cannot succeed until the suspension is
 * lifted, so callers stop rather than retry.
 */
export class AccountSuspendedError extends Error {
  override readonly name = "AccountSuspendedError";

  constructor() {
    super("This account is suspended.");
  }
}

/** A verify result's login, null for an ordinary refusal; throws on suspension. */
export function verifiedLogin<Data>(result: RequestResult<Data>): Data | null {
  if (result.ok) {
    return result.data;
  }
  if (result.code === VERIFY_ERROR_CODES.accountSuspended) {
    throw new AccountSuspendedError();
  }
  return null;
}
