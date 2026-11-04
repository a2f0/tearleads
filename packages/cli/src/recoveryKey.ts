// A recovery key is the BIP39 seed phrase the app shows in Identity Manager.
// Normalizing it to lowercase words separated by single spaces also makes it
// safe to quote for the Keychain's interactive command reader.
const RECOVERY_KEY_PATTERN = /^[a-z]+(?: [a-z]+)*$/u;

export function normalizeRecoveryKey(input: string): string {
  const normalized = input.trim().toLowerCase().split(/\s+/u).join(" ");
  if (!RECOVERY_KEY_PATTERN.test(normalized)) {
    throw new Error(
      "A recovery key is a list of words separated by spaces, as Identity Manager shows it.",
    );
  }
  return normalized;
}
