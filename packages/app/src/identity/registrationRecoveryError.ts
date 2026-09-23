import {
  IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE,
  isIdentityAcknowledgmentMismatch,
} from "./identityAcknowledgmentMismatch";

/** A known local account binding could not be recovered through login. */
export class RegistrationRecoveryError extends Error {
  constructor(online: boolean) {
    super(
      online
        ? "This identity is already registered on this device. Try logging in again. If the server environment was reset, clear local app data before registering again."
        : "Authentication failed: no network connection.",
    );
    this.name = "RegistrationRecoveryError";
  }
}

/**
 * An acknowledgment mismatch is named distinctly: the SDK has already recorded
 * it as a security incident, and retrying registration cannot resolve it.
 */
export function autoRegisterFailureMessage(error: unknown): string {
  if (error instanceof RegistrationRecoveryError)
    return `Auto-register identity refused: ${error.message}`;
  return isIdentityAcknowledgmentMismatch(error)
    ? `Auto-register identity refused: ${IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE}`
    : "Failed to auto-register identity";
}
