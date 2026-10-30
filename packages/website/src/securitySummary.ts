/**
 * The Home page's security highlights. Keep the wording consistent with
 * /security (src/pages/security.astro and its components), which carries each
 * protection's assumptions and scope in full: narrowing a claim is fine,
 * strengthening one is not. Each row names its sources and links the /security
 * section that covers it.
 */
interface SecuritySummaryRow {
  readonly id: string;
  readonly title: string;
  readonly protection: string;
  readonly href: string;
}

export const securitySummary: readonly SecuritySummaryRow[] = [
  {
    // docs/keying-design.md "Design Properties" (the server stores ciphertext
    // and wrapped keys, not plaintext content keys); docs/security-guarantees.md
    // "Short Answer".
    id: "content",
    title: "Encrypted on your device",
    protection:
      "Document and file contents, organization names, and custom group names are encrypted on your device before they sync. The service stores ciphertext and wrapped keys, not plaintext content keys.",
    href: "/security/#device-boundary",
  },
  {
    // docs/security-guarantees.md "Signed Access Manifests", "Forged Group Or
    // Organization Membership", and "Projection Rows Are Not A Security
    // Boundary".
    id: "sharing",
    title: "Verified sharing",
    protection:
      "The app works out who can receive a folder's keys from signed access records and group policies that it verifies itself, so access follows signatures rather than the server's membership rows.",
    href: "/security/#verified-sharing",
  },
  {
    // docs/security-guarantees.md "Principal Changes And Their Containers
    // Commit Atomically".
    id: "removing-access",
    title: "Atomic key rotation",
    protection:
      "Removing group members rotates the group key and the affected folder keys in one atomic update.",
    href: "/security/#verified-sharing",
  },
  {
    // docs/security-guarantees.md "Local At-Rest Key Wrapping" (the host
    // wrapping key, as named in Fig. 2 on /security; a PIN is optional).
    id: "your-device",
    title: "Encrypted at rest",
    protection:
      "Local data is stored encrypted, under keys protected by a host wrapping key, and you can add a PIN lock.",
    href: "/security/#local-storage",
  },
];
