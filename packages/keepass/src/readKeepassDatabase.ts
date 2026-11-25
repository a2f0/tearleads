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

/** kdbxweb's `Error <Code>: <detail>` message without its prefix. */
function kdbxDetail(error: KdbxError): string {
  return error.message.replace(/^Error \w+(: )?/u, "") || error.code;
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
        `This database uses a format the importer does not support (${kdbxDetail(error)}). KDBX 3.1 and 4 with AES or ChaCha20 are supported; Twofish is not.`,
      );
    default:
      return new KeepassReadError(
        "corrupt",
        `The database could not be read: ${kdbxDetail(error)}.`,
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

/**
 * The composite keys to try, in order. A blank password is ambiguous: a
 * database can have no password component or an explicitly empty one. Like
 * KeePassXC, try without a password first (with the key file), then with an
 * empty one.
 */
function credentialAttempts(
  credentials: KeepassCredentials,
): readonly KdbxCredentials[] {
  const { keyFile = null, password } = credentials;
  if (password === undefined && !keyFile) {
    throw new KeepassReadError(
      "no-credentials",
      "A master password or key file is required.",
    );
  }
  if (password) {
    return [new KdbxCredentials(ProtectedValue.fromString(password), keyFile)];
  }
  const empty = new KdbxCredentials(ProtectedValue.fromString(""), keyFile);
  if (!keyFile) return [empty];
  return password === undefined
    ? [new KdbxCredentials(null, keyFile)]
    : [new KdbxCredentials(null, keyFile), empty];
}

async function loadKdbx(
  bytes: Uint8Array,
  attempts: readonly KdbxCredentials[],
): Promise<KdbxDatabase> {
  installArgon2();
  for (const [index, credentials] of attempts.entries()) {
    try {
      return await KdbxDatabase.load(bytes.slice().buffer, credentials);
    } catch (error) {
      // kdbxweb reads a cut-off header past its end rather than reporting it.
      if (error instanceof RangeError) {
        throw new KeepassReadError(
          "corrupt",
          "The database could not be read: the file is cut off or damaged.",
        );
      }
      if (!(error instanceof KdbxError)) throw error;
      const retry =
        error.code === Consts.ErrorCodes.InvalidKey &&
        index < attempts.length - 1;
      if (!retry) throw describeKdbxError(error);
    }
  }
  throw new KeepassReadError("no-credentials", "No key was tried.");
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
  const database = await loadKdbx(bytes, credentialAttempts(credentials));
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
