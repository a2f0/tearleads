import { basename, extname } from "node:path";
import {
  KEEPASS_MAX_FILE_BYTES,
  type KeepassDatabase,
  type KeepassGroup,
  readKeepassDatabase,
} from "@tearleads/keepass";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "app/continuity";
import type { CommandInput, KeepassRestoreOptions } from "../cliContext";
import {
  createRestoreFolders,
  partialRestoreError,
  uniqueFolderName,
} from "../keepass/restoreFolders";
import { createRestoredPasscodes } from "../keepass/restorePasscodes";
import { printable } from "../printable";
import { resolveSeedAccount } from "../seedAccount";
import { apiLabel, requireRecoveryKey, withRecoveryKey } from "./account";

// KeePass key files are small (XML, 32 or 64 bytes, or any file hashed whole).
const KEY_FILE_MAX_BYTES = 1024 * 1024;

async function readLocalFile(
  path: string,
  label: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`No ${label} at ${path}.`);
  if (file.size > maxBytes) {
    throw new Error(`The ${label} at ${path} is too large.`);
  }
  return new Uint8Array(await file.arrayBuffer());
}

/** The restore folder's name: --name, the database's name, or the file's. */
function restoreFolderName(
  options: KeepassRestoreOptions,
  database: KeepassDatabase,
): string {
  const fromFile = basename(options.file, extname(options.file));
  return (
    [options.folderName, database.name, fromFile]
      .map((name) => name?.trim() ?? "")
      .find((name) => name.length > 0) ?? "KeePass"
  );
}

interface GroupCounts {
  attachments: number;
  entries: number;
  groups: number;
  history: number;
}

function countGroup(group: KeepassGroup, counts: GroupCounts): GroupCounts {
  counts.groups += 1;
  for (const entry of group.entries) {
    counts.entries += 1;
    counts.attachments += entry.attachments.length;
    counts.history += entry.historyCount;
  }
  for (const child of group.groups) countGroup(child, counts);
  return counts;
}

function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}

function reportRestore(
  input: CommandInput,
  database: KeepassDatabase,
  result: { folderId: string; folderName: string; passcodes: number },
) {
  const counts = countGroup(database.root, {
    attachments: 0,
    entries: 0,
    groups: 0,
    history: 0,
  });
  input.context.stdout(
    printable(
      `Restored ${plural(result.passcodes, "passcode")} in ${plural(counts.groups, "folder")} to "${result.folderName}" (${result.folderId}) on ${apiLabel(input)}.`,
    ),
  );
  const leftOut = [
    database.skipped.recycledEntries
      ? `${plural(database.skipped.recycledEntries, "entry", "entries")} in the recycle bin`
      : null,
    counts.attachments
      ? `${plural(counts.attachments, "attachment")} (not imported yet)`
      : null,
    counts.history ? plural(counts.history, "history version") : null,
  ].filter((part) => part !== null);
  if (leftOut.length > 0) {
    input.context.stdout(`Left out: ${leftOut.join(", ")}.`);
  }
}

function requireRestoreOptions(input: CommandInput): KeepassRestoreOptions {
  if (!input.keepass) throw new Error("restore-keepass needs a .kdbx file.");
  return input.keepass;
}

/**
 * Decrypts a KeePass database locally, then restores it into a new folder
 * under the signed-in account's root: one folder per group, one passcode per
 * entry. Every run makes a new folder.
 */
export async function restoreKeepass(input: CommandInput): Promise<void> {
  const options = requireRestoreOptions(input);
  const { context, tracer } = input;
  // Ask for the vault's password only once the restore can sign in.
  const recoveryKey = await requireRecoveryKey(input);
  const bytes = await readLocalFile(
    options.file,
    "KeePass database",
    KEEPASS_MAX_FILE_BYTES,
  );
  const keyFile = options.keyFile
    ? await readLocalFile(options.keyFile, "key file", KEY_FILE_MAX_BYTES)
    : undefined;
  const password = await context.readPassword("Master password: ");
  // Decrypt before signing in, so a wrong password costs no session.
  const database = await tracer.span("decrypt KeePass database", () =>
    readKeepassDatabase(bytes, { keyFile, password }),
  );
  const result = await withRecoveryKey(
    input,
    recoveryKey,
    async (session) => {
      const { folders, rootId, signingPrivateKey } = await resolveSeedAccount(
        session,
        input.organizationId,
        "restore-keepass",
      );
      const folderName = uniqueFolderName(
        restoreFolderName(options, database),
        new Set(
          folders
            .filter((node) => node.parentId === rootId)
            .map((node) => node.name),
        ),
      );
      try {
        const groups = await createRestoreFolders(session, {
          folderName,
          root: database.root,
          rootId,
        });
        const passcodes = await createRestoredPasscodes(session, {
          groups,
          signingPrivateKey,
        });
        return { folderId: groups[0]?.folderId ?? "", folderName, passcodes };
      } catch (error) {
        // The folder may already hold part of the restore; say which one.
        throw partialRestoreError(error, folderName);
      }
    },
    {
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      automaticSessionRenewal: false,
    },
  );
  reportRestore(input, database, result);
}
