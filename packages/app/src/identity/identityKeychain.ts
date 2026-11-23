import { useMemo } from "react";
import type {
  PasswordKeychain,
  PasswordKeychainEntry,
  PasswordKeychainSaveOutcome,
} from "../host/PasswordKeychain";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";

/**
 * The keychain entry for an identity. Its name says what the password manager
 * is being asked to keep, since a save prompt shows only the name, and tells
 * identities apart by their signing fingerprint's first 12 characters, as a
 * recovery key download's file name does. Every save of one identity therefore
 * updates the same entry.
 */
export function identityKeychainEntry(
  signingFingerprint: string,
  passphrase: string,
): PasswordKeychainEntry {
  return {
    account: `Recovery key ${signingFingerprint.slice(0, 12)}`,
    passphrase,
  };
}

/** What a save's outcome tells the user, for a status line or the log. */
export const KEYCHAIN_SAVE_STATUS: Record<PasswordKeychainSaveOutcome, string> =
  {
    dismissed: "The recovery key was not saved to your password manager.",
    offered: "Offered to save the recovery key to your password manager.",
    saved: "Recovery key saved to your password manager.",
    unavailable:
      "No password manager on this device can save the recovery key. Sign in to one in Settings.",
  };

/** The host's password keychain, or `null` where the platform has none. */
export function usePasswordKeychain(): PasswordKeychain | null {
  const { createPasswordKeychain } = useAppHostConfig();
  return useMemo(
    () => createPasswordKeychain?.() ?? null,
    [createPasswordKeychain],
  );
}
