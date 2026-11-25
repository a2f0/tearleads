import {
  Consts,
  KdbxBinaries,
  type KdbxBinary,
  type KdbxBinaryWithHash,
  KdbxCredentials,
  Kdbx as KdbxDatabase,
  type KdbxEntry,
  KdbxError,
  type KdbxGroup,
  type KdbxUuid,
  ProtectedValue,
} from "kdbxweb";
import { installArgon2 } from "./argon2";
import type {
  KeepassAttachment,
  KeepassCredentials,
  KeepassCustomField,
  KeepassDatabase,
  KeepassEntry,
  KeepassGroup,
} from "./keepassModel";

/** Larger than any password database; a guard against reading the wrong file. */
export const KEEPASS_MAX_FILE_BYTES = 64 * 1024 * 1024;

const STANDARD_FIELDS: ReadonlySet<string> = new Set([
  "Notes",
  "Password",
  "Title",
  "URL",
  "UserName",
]);

export type KeepassReadErrorCode =
  | "corrupt"
  | "no-credentials"
  | "not-kdbx"
  | "too-large"
  | "unsupported"
  | "wrong-key";

/** Why a file could not be opened, phrased for the person running the import. */
export class KeepassReadError extends Error {
  constructor(
    readonly code: KeepassReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KeepassReadError";
  }
}

function describeKdbxError(error: KdbxError): KeepassReadError {
  switch (error.code) {
    case Consts.ErrorCodes.InvalidKey:
      return new KeepassReadError(
        "wrong-key",
        "The master password or key file is wrong.",
      );
    case Consts.ErrorCodes.BadSignature:
      return new KeepassReadError(
        "not-kdbx",
        "This is not a KeePass 2 (.kdbx) database.",
      );
    case Consts.ErrorCodes.InvalidVersion:
    case Consts.ErrorCodes.Unsupported:
      return new KeepassReadError(
        "unsupported",
        `This database uses a format the importer does not support (${error.message}). KDBX 3.1 and 4 with AES or ChaCha20 are supported; Twofish is not.`,
      );
    default:
      return new KeepassReadError(
        "corrupt",
        `The database could not be read: ${error.message}.`,
      );
  }
}

function fieldText(value: string | ProtectedValue | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.getText();
}

function isoTime(time: Date | undefined): string | null {
  return time && Number.isFinite(time.getTime()) ? time.toISOString() : null;
}

function binaryByteLength(binary: KdbxBinary | KdbxBinaryWithHash): number {
  const value = KdbxBinaries.isKdbxBinaryWithHash(binary)
    ? binary.value
    : binary;
  return value.byteLength;
}

function readCustomFields(entry: KdbxEntry): KeepassCustomField[] {
  const fields: KeepassCustomField[] = [];
  for (const [name, value] of entry.fields) {
    if (STANDARD_FIELDS.has(name)) continue;
    fields.push({
      name,
      protected: value instanceof ProtectedValue,
      value: fieldText(value),
    });
  }
  return fields;
}

function readAttachments(entry: KdbxEntry): KeepassAttachment[] {
  return [...entry.binaries].map(([name, binary]) => ({
    byteLength: binaryByteLength(binary),
    name,
  }));
}

function readEntry(entry: KdbxEntry): KeepassEntry {
  const field = (name: string) => fieldText(entry.fields.get(name));
  return {
    attachments: readAttachments(entry),
    createdAt: isoTime(entry.times.creationTime),
    customFields: readCustomFields(entry),
    expiresAt: entry.times.expires ? isoTime(entry.times.expiryTime) : null,
    historyCount: entry.history.length,
    id: entry.uuid.id,
    modifiedAt: isoTime(entry.times.lastModTime),
    notes: field("Notes"),
    password: field("Password"),
    tags: [...entry.tags],
    title: field("Title"),
    url: field("URL"),
    username: field("UserName"),
  };
}

interface Recycled {
  entries: number;
  groups: number;
}

function countRecycled(group: KdbxGroup, recycled: Recycled): void {
  recycled.groups += 1;
  recycled.entries += group.entries.length;
  for (const child of group.groups) countRecycled(child, recycled);
}

function readGroup(
  group: KdbxGroup,
  recycleBin: KdbxUuid | undefined,
  recycled: Recycled,
): KeepassGroup {
  const groups: KeepassGroup[] = [];
  for (const child of group.groups) {
    if (recycleBin && child.uuid.equals(recycleBin)) {
      countRecycled(child, recycled);
      continue;
    }
    groups.push(readGroup(child, recycleBin, recycled));
  }
  return {
    entries: group.entries.map(readEntry),
    groups,
    id: group.uuid.id,
    name: group.name ?? "",
  };
}

function toCredentials(credentials: KeepassCredentials): KdbxCredentials {
  const { keyFile, password } = credentials;
  // KeePass treats a blank password as no password component at all.
  const hasPassword = password !== undefined && password.length > 0;
  if (!hasPassword && !keyFile) {
    throw new KeepassReadError(
      "no-credentials",
      "A master password or key file is required.",
    );
  }
  return new KdbxCredentials(
    hasPassword ? ProtectedValue.fromString(password) : null,
    keyFile ?? null,
  );
}

async function loadKdbx(
  bytes: Uint8Array,
  credentials: KdbxCredentials,
): Promise<KdbxDatabase> {
  installArgon2();
  const buffer = bytes.slice().buffer;
  try {
    return await KdbxDatabase.load(buffer, credentials);
  } catch (error) {
    if (error instanceof KdbxError) throw describeKdbxError(error);
    throw error;
  }
}

/**
 * Decrypts a KeePass 2 database (KDBX 3.1 or 4) into plain records. The
 * recycle bin and its contents are left out and counted.
 */
export async function readKeepassDatabase(
  bytes: Uint8Array,
  credentials: KeepassCredentials,
): Promise<KeepassDatabase> {
  if (bytes.byteLength > KEEPASS_MAX_FILE_BYTES) {
    throw new KeepassReadError(
      "too-large",
      `The file is larger than ${KEEPASS_MAX_FILE_BYTES / (1024 * 1024)} MiB.`,
    );
  }
  const database = await loadKdbx(bytes, toCredentials(credentials));
  const recycleBin = database.meta.recycleBinEnabled
    ? database.meta.recycleBinUuid
    : undefined;
  const recycled: Recycled = { entries: 0, groups: 0 };
  const root = readGroup(database.getDefaultGroup(), recycleBin, recycled);
  return {
    name: database.meta.name ?? "",
    root,
    skipped: {
      recycledEntries: recycled.entries,
      recycledGroups: recycled.groups,
    },
  };
}
