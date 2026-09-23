/** A known local account binding could not be recovered through login. */
export class RegistrationRecoveryError extends Error {
  constructor() {
    super(
      "This identity is already registered on this device. Try logging in again. If the server environment was reset, clear local app data before registering again.",
    );
    this.name = "RegistrationRecoveryError";
  }
}
