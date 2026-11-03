// Names and IDs come from the API and from other users (a shared folder's
// name), so they may carry terminal control sequences or bidirectional
// overrides that would rewrite what the user sees. Escape them instead.
const UNSAFE_CHARACTERS = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

export function printable(text: string): string {
  return text.replace(
    UNSAFE_CHARACTERS,
    (character) =>
      `\\u{${(character.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}}`,
  );
}
