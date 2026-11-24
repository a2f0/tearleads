import { Capacitor } from "@capacitor/core";
import type {
  PasswordKeychain,
  PasswordKeychainSaveOutcome,
} from "app/host/AppHostConfig";

/**
 * The native PasswordKeychain plugin: Android's Credential Manager, or iCloud
 * Keychain on iOS under the domain the build's entitlement names.
 */
export interface NativePasswordKeychainPlugin {
  pick(): Promise<{ readonly passphrase?: unknown }>;
  save(options: {
    readonly account: string;
    readonly passphrase: string;
  }): Promise<{ readonly outcome?: unknown }>;
}

const SAVE_OUTCOMES: ReadonlyArray<PasswordKeychainSaveOutcome> = [
  "dismissed",
  "offered",
  "saved",
  "unavailable",
];

/**
 * A {@link PasswordKeychain} over the native plugin. The plugin reports
 * whether the user kept the entry; an answer outside the known outcomes is a
 * failure rather than a guess.
 */
export function createCapacitorPasswordKeychain(
  plugin: () => NativePasswordKeychainPlugin,
): PasswordKeychain {
  return {
    async pick() {
      const { passphrase } = await plugin().pick();
      return typeof passphrase === "string" && passphrase !== ""
        ? passphrase
        : null;
    },
    async save({ account, passphrase }) {
      const { outcome } = await plugin().save({ account, passphrase });
      const known = SAVE_OUTCOMES.find((candidate) => candidate === outcome);
      if (!known) {
        throw new Error("The password manager reported an unknown outcome.");
      }
      return known;
    },
  };
}

let nativePasswordKeychain: NativePasswordKeychainPlugin | undefined;

/**
 * The device's keychain: Google Password Manager through Android's Credential
 * Manager, or iCloud Keychain on iOS for the build's `webcredentials:` domain.
 */
export function createNativePasswordKeychain(): PasswordKeychain {
  return createCapacitorPasswordKeychain(() => {
    nativePasswordKeychain ??=
      Capacitor.registerPlugin<NativePasswordKeychainPlugin>(
        "PasswordKeychain",
      );
    return nativePasswordKeychain;
  });
}
