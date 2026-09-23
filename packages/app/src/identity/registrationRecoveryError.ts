import {
  IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE,
  isIdentityAcknowledgmentMismatch,
} from "./identityAcknowledgmentMismatch";

/** A known local account binding could not be recovered through login. */
export class RegistrationRecoveryError extends Error {
  constructor(online: boolean) {
    super(
      online
        ? "This identity is already registered on this device. Login failed; check the connection and server availability, then try again. Only if the server was deliberately reset should you save your recovery phrase and any needed local data, then clear local app data before registering again."
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
    return `Auto-register identity failed: ${error.message}`;
  return isIdentityAcknowledgmentMismatch(error)
    ? `Auto-register identity refused: ${IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE}`
    : "Failed to auto-register identity";
}
