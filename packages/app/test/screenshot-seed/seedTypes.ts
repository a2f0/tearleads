import type { StoredDocumentKind } from "@tearleads/client-sdk";

// Declarative description of the data seeded into a screenshot backup artifact.
// Authored in fixtures/seed.json and interpreted by buildSeedArtifact.ts. Kept
// deliberately small: it maps to the mini-apps (Contacts / Notes / Explorer),
// not to raw SQLite rows, so authors never touch the encrypted schema.

export interface SeedContact {
  // Contact structured fields. Display name is DERIVED (nickname, else
  // "firstName lastName") — there is intentionally no displayName/email/phone.
  readonly fields: {
    readonly firstName?: string;
    readonly lastName?: string;
    readonly nickname?: string;
    readonly userId?: string;
  };
}

export interface SeedNote {
  // The whole note body. Its title is derived from the first non-empty line.
  readonly text: string;
}

export interface SeedAttachment {
  /** Fixture file name (resolved against the fixtures dir by the CLI). */
  readonly file: string;
  readonly mimeType: string;
  /**
   * Named slot for slotted document kinds (e.g. drivers_license: "front" /
   * "back"). Omit for single-attachment kinds like `image`, which append.
   */
  readonly slot?: string;
}

export interface SeedFile {
  /** A non-note document kind, e.g. "image" | "drivers_license" | "pdf". */
  readonly kind: Exclude<StoredDocumentKind, "note">;
  readonly title?: string;
  /** Structured fields for the kind (e.g. fileName, licenseId, expirationDate). */
  readonly fields?: Readonly<Record<string, string>>;
  readonly attachments: readonly SeedAttachment[];
}

export interface SeedSpec {
  /** Password the artifact is encrypted with; the Playwright restore reuses it. */
  readonly password: string;
  /**
   * Fixed BIP39 seed phrase the artifact's identity is derived from. The seeder
   * imports it (deterministic signing key), so the Contacts system slot —
   * HMAC(definition, signingPrivateKey) — is reproducible. The Playwright run
   * imports the SAME phrase before restoring, so that slot re-derives and the
   * Contacts mini-app resolves the seeded container. Must be a valid phrase.
   */
  readonly identitySeedPhrase: string;
  readonly contacts?: readonly SeedContact[];
  readonly notes?: readonly SeedNote[];
  readonly files?: readonly SeedFile[];
}
