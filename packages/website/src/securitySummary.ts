/**
 * The Home page's claim-and-limit ledger. Every protection is paired with its
 * limit, and each row names its sources. Keep the wording consistent with
 * /security (src/pages/security.astro and its components): narrowing a claim or
 * adding a limit is fine, strengthening one is not.
 *
 * Home shows the four rows a first-time visitor needs; /security carries the
 * rest (history and rollback, availability) in full.
 */
interface SecuritySummaryRow {
  readonly id: string;
  readonly title: string;
  readonly protection: string;
  readonly limit: string;
  /** Optional link on a phrase of the limit text; `label` must occur in it. */
  readonly limitLink?: { readonly href: string; readonly label: string };
}

export const securitySummary: readonly SecuritySummaryRow[] = [
  {
    // docs/keying-design.md "Design Properties" (the server stores ciphertext
    // and wrapped keys, not plaintext content keys) and "Boundaries" (structure
    // is not hidden); docs/security-guarantees.md "Short Answer".
    id: "content",
    title: "Content",
    protection:
      "Document and file contents, organization names, and custom group names are encrypted on your device before they sync. The service stores ciphertext and wrapped keys, not plaintext content keys.",
    limit:
      "The service can see built-in group roles, membership, folder and file structure, identifiers, public keys, access relationships, who signed each change and when, sizes, IP addresses, and traffic patterns such as request timing. See the full list.",
    limitLink: {
      href: "/security#device-boundary",
      label: "See the full list",
    },
  },
  {
    // docs/security-guarantees.md "Signed Access Manifests", "Forged Group Or
    // Organization Membership", "Projection Rows Are Not A Security Boundary",
    // and "First-Contact Identity-Key Substitution".
    id: "sharing",
    title: "Sharing",
    protection:
      "The app works out who can receive a folder's keys from signed access records and group policies that it verifies. Editing a membership row on the server is not enough to grant access.",
    limit:
      "Trust starts at first contact: a server that substitutes someone's key on the first lookup can still establish a false identity.",
  },
  {
    // docs/security-guarantees.md "Principal Changes And Their Containers
    // Commit Atomically"; docs/keying-design.md "Boundaries" (no retroactive
    // revocation) and "Current access is history-inclusive".
    id: "removing-access",
    title: "Removing access",
    protection:
      "Removing group members rotates the group key and the affected folder keys in one atomic update.",
    limit:
      "It can't take back content or keys someone already received. New members can read a folder's retained history, and nested folders have further limits.",
    limitLink: { href: "/security#trust-boundaries", label: "further limits" },
  },
  {
    // docs/security-guarantees.md "Local At-Rest Key Wrapping" (the host
    // wrapping key, as named in Fig. 1 on /security; no PIN by default) and
    // "Recovery Key Disclosure"; packages/app-electrobun/src/renderer/index.tsx
    // and packages/app-capacitor/src/index.tsx (localKeyringKeyMaterialStorage:
    // "raw-bytes"); client-sdk localKeyring/types.ts WrappingKeyMaterialStorage;
    // offline PIN guessing per packages/app pinCodePolicy.ts. A browser's
    // stored CryptoKey can sit in the profile's IndexedDB files, hence "may".
    id: "your-device",
    title: "Your device",
    protection:
      "Local data is stored encrypted, under keys protected by a host wrapping key and an optional PIN.",
    limit:
      "Protection depends on where the platform keeps that wrapping key. The desktop and mobile apps store it as key bytes alongside the app's data, so without a PIN a copy of that data can be decrypted, and with a PIN it can be attacked by guessing PINs offline. In a browser, a copy of the browser's stored data may allow the same. An unlocked or compromised device exposes content, and anyone with your recovery phrase can recover your identity.",
  },
];
