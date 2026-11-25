/**
 * A decrypted KeePass database as plain records: no kdbxweb types, no
 * protected-value wrappers. Every secret is a plain string, so hold a value
 * only as long as the import that needs it.
 */
export interface KeepassDatabase {
  /** The database name from its metadata; blank when it has none. */
  readonly name: string;
  /** The root group. Its entries sit directly in the database. */
  readonly root: KeepassGroup;
  /** What was left out: the recycle bin and everything in it. */
  readonly skipped: KeepassSkipped;
}

export interface KeepassSkipped {
  readonly recycledEntries: number;
  readonly recycledGroups: number;
}

export interface KeepassGroup {
  /** The group's KeePass UUID, base64. */
  readonly id: string;
  readonly name: string;
  readonly groups: readonly KeepassGroup[];
  readonly entries: readonly KeepassEntry[];
}

export interface KeepassEntry {
  /** The entry's KeePass UUID, base64. */
  readonly id: string;
  readonly title: string;
  readonly username: string;
  readonly password: string;
  readonly url: string;
  readonly notes: string;
  readonly tags: readonly string[];
  /** ISO 8601, set only when the entry is marked to expire. */
  readonly expiresAt: string | null;
  readonly createdAt: string | null;
  readonly modifiedAt: string | null;
  /** String fields beyond the five standard ones, in file order. */
  readonly customFields: readonly KeepassCustomField[];
  readonly attachments: readonly KeepassAttachment[];
  /** Earlier versions KeePass kept of this entry. */
  readonly historyCount: number;
}

export interface KeepassCustomField {
  readonly name: string;
  readonly value: string;
  /** KeePass's "protect in memory" flag: the UI masks the value. */
  readonly protected: boolean;
}

export interface KeepassAttachment {
  readonly name: string;
  readonly byteLength: number;
}

export interface KeepassCredentials {
  readonly password?: string | undefined;
  /** The key file's bytes, in any format KeePass accepts. */
  readonly keyFile?: Uint8Array | undefined;
}
