import { useCallback, useMemo } from "react";
import type {
  PasswordKeychain,
  PasswordKeychainEntry,
  PasswordKeychainSaveOutcome,
} from "../host/PasswordKeychain";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";

/**
 * The keychain entry for an identity. It names the identity by its signing
 * fingerprint's first 12 characters, as a recovery key download's file name
 * does, so every save of one identity updates the same entry.
 */
export function identityKeychainEntry(
  signingFingerprint: string,
  passphrase: string,
): PasswordKeychainEntry {
  return {
    account: `Identity ${signingFingerprint.slice(0, 12)}`,
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

/**
 * Offers the current identity's recovery passphrase to the platform's password
 * keychain, once onboarding has created the identity or restored it from its
 * passphrase. The platform's own save prompt is the consent, so unlike
 * Identity Manager's Save to Password Manager this asks for no typed acknowledgement.
 * A failure is logged and never blocks onboarding; a device with no password
 * manager is an outcome, logged locally rather than reported as an error.
 */
export function useOfferIdentityKeychainSave(): () => void {
  const keychain = usePasswordKeychain();
  const sdk = useTearleads();
  const { log, logError } = useLog();
  return useCallback(() => {
    const { seedPhrase, signingFingerprint } = sdk.identity;
    if (!keychain || !seedPhrase || !signingFingerprint) return;
    void keychain
      .save(identityKeychainEntry(signingFingerprint, seedPhrase))
      .then(
        (outcome) => log(KEYCHAIN_SAVE_STATUS[outcome]),
        (error: unknown) =>
          logError(
            "Failed to offer the recovery key to the password manager",
            error,
          ),
      );
  }, [keychain, log, logError, sdk]);
}
