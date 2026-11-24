/**
 * An identity's recovery passphrase as the platform's password keychain holds
 * it: the browser's password manager, Google Password Manager through
 * Android's Credential Manager, or iCloud Keychain on iOS.
 */
export interface PasswordKeychainEntry {
  /** What the keychain lists the entry under, as its username. */
  readonly account: string;
  readonly passphrase: string;
}

/**
 * How a save prompt ended. `offered` means the platform showed its prompt but
 * does not report the user's choice, as browsers do. `unavailable` means no
 * password manager on the device can save, as on an Android device signed in
 * to no Google account: an ordinary device state, not a failure.
 */
export type PasswordKeychainSaveOutcome =
  | "dismissed"
  | "offered"
  | "saved"
  | "unavailable";

/**
 * The platform's password keychain. Each call shows the platform's own UI,
 * which is where the user consents: saving asks whether to keep the entry, and
 * picking lists the saved entries. Failures reject; the user declining, or the
 * device having no password manager, does not.
 */
export interface PasswordKeychain {
  /** Offers to save `entry`, resolving once the prompt is shown or closed. */
  save(entry: PasswordKeychainEntry): Promise<PasswordKeychainSaveOutcome>;
  /** Lets the user pick a saved passphrase; `null` when they dismiss it. */
  pick(): Promise<string | null>;
}

export type CreatePasswordKeychainFn = () => PasswordKeychain;
