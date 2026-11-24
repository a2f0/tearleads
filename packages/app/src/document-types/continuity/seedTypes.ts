import type { StoredDocumentKind } from "@tearleads/client-sdk";

// Declarative description of the data seeded into an account. Supplied by
// Continuity and written by the CLI's `seed` command (continuityDocuments, then
// writeContinuityDocument), which also seeds the screenshot run. Kept
// deliberately small: it maps to the mini-apps (Contacts / Notes / Explorer),
// not to raw SQLite rows, so authors never touch the encrypted schema.

export interface SeedContact {
  /** Continuity's character ID, stable across versions; groups cite it. */
  readonly id: string;
  readonly avatar?: Pick<SeedAttachment, "file" | "mimeType">;
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
  /** First-class document rows, written through DocumentStore.addRow. */
  readonly rows?: readonly Readonly<Record<string, string>>[];
}

/** An organization group: its name and the `id`s of its member contacts. */
export interface SeedGroup {
  readonly name: string;
  readonly members: readonly string[];
}

export interface SeedSpec {
  readonly schemaVersion: 3;
  /**
   * Fixed BIP39 seed phrase of the account the screenshot run seeds and signs
   * in as. Its deterministic signing key makes the Contacts system slot,
   * HMAC(definition, signingPrivateKey), reproducible, so a browser that
   * imports the same phrase resolves the seeded Contacts container. Must be a
   * valid phrase.
   */
  readonly identitySeedPhrase: string;
  readonly contacts?: readonly SeedContact[];
  readonly notes?: readonly SeedNote[];
  readonly files?: readonly SeedFile[];
  /** Seeded only on request (`tearleads seed --roster`). */
  readonly groups?: readonly SeedGroup[];
}
