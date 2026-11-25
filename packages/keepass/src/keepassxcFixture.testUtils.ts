/**
 * A KDBX 3.1 database written by KeePassXC 2.7.4 (`keepassxc-cli import` of a
 * hand-written XML export), so the reader is checked against the real writer
 * and not only against kdbxweb's own output. Its master password is
 * `fixture-pass`. Kept as base64 text: the repository admits no binary files.
 *
 * Contents: the root group "Family Vault" holding "Bank"; "Email/Work"
 * holding "Mail" (custom fields, protected PIN and TOTP, tags, expiry, one
 * history version, one attachment); and a recycle bin holding an entry and a
 * subgroup with another entry.
 */
export const KEEPASSXC_FIXTURE_PASSWORD = "fixture-pass";

export const KEEPASSXC_FIXTURE_BASE64 = [
  "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",
].join("");
