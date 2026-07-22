/**
 * Minimum strength policy for a local-keyring PIN code.
 *
 * The PIN is stretched with PBKDF2 (310k iterations, random per-key salt) before
 * it wraps the keyring's root key, which is the right cost for a password but
 * does not rescue a low-entropy PIN: the candidate space, not the KDF, bounds an
 * offline attack. That attack is only reachable where the *inner* wrapping key is
 * also recoverable — i.e. on shells persisting it as raw bytes (Capacitor and
 * Electrobun, see `WrappingKeyMaterialStorage`), where an attacker holding a
 * device backup has both halves. On a browser the inner key is a non-extractable
 * CryptoKey, so the PIN is not independently attackable.
 *
 * The policy is applied uniformly rather than per-shell: the same manifest can be
 * opened by whichever shell the user installs next, so the weakest shell that can
 * ever read it sets the bar.
 *
 * Enforced on set/change only. Unlock deliberately does not validate — a PIN
 * chosen before this policy existed must still open the keyring it wrapped.
 */
export const MIN_PIN_CODE_LENGTH = 6;

function isSingleRepeatedCharacter(characters: readonly string[]): boolean {
  return characters.every((character) => character === characters[0]);
}

/**
 * True for a straight run in either direction ("123456", "987654"). Compares
 * code points, so it catches digit and letter runs alike.
 */
function isSequentialRun(characters: readonly string[]): boolean {
  const codePoints = characters.map((character) => character.codePointAt(0));
  const step = (codePoints[1] ?? 0) - (codePoints[0] ?? 0);
  if (step !== 1 && step !== -1) {
    return false;
  }

  return codePoints.every(
    (codePoint, index) =>
      index === 0 || codePoint === (codePoints[0] ?? 0) + step * index,
  );
}

/**
 * Returns a user-facing reason the PIN is too weak, or null when it passes.
 * Shared by the identity-manager form (for immediate feedback) and the set-PIN
 * action (so the policy cannot be bypassed by a caller that skips the form).
 */
export function pinCodePolicyError(pinCode: string): string | null {
  // Split into code points, not UTF-16 units. `"😀".length` is 2, so a
  // three-emoji PIN would otherwise measure as six characters and clear the
  // length bar; indexing would also compare lone surrogate halves, which never
  // match a full code point and so silently disabled the repetition check.
  const characters = [...pinCode];
  if (characters.length < MIN_PIN_CODE_LENGTH) {
    return `PIN code must be at least ${MIN_PIN_CODE_LENGTH} characters.`;
  }
  if (isSingleRepeatedCharacter(characters)) {
    return "PIN code must not repeat a single character.";
  }
  if (isSequentialRun(characters)) {
    return "PIN code must not be a sequential run of characters.";
  }

  return null;
}
