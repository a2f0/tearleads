import {
  Consts,
  KdbxCredentials,
  Kdbx as KdbxDatabase,
  type KdbxGroup,
  ProtectedValue,
} from "kdbxweb";
import { installArgon2 } from "./argon2";

/** An entry for a generated test database; protected fields are masked. */
export interface KeepassTestEntry {
  readonly fields: Readonly<Record<string, string>>;
  readonly protectedFields?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
}

export interface KeepassTestGroup {
  readonly name: string;
  readonly entries?: readonly KeepassTestEntry[];
  readonly groups?: readonly KeepassTestGroup[];
}

function addEntries(
  database: KdbxDatabase,
  parent: KdbxGroup,
  spec: KeepassTestGroup,
): void {
  for (const entrySpec of spec.entries ?? []) {
    const entry = database.createEntry(parent);
    for (const [name, value] of Object.entries(entrySpec.fields)) {
      entry.fields.set(name, value);
    }
    for (const [name, value] of Object.entries(
      entrySpec.protectedFields ?? {},
    )) {
      entry.fields.set(name, ProtectedValue.fromString(value));
    }
    entry.tags = [...(entrySpec.tags ?? [])];
  }
  for (const childSpec of spec.groups ?? []) {
    const child = database.createGroup(parent, childSpec.name);
    addEntries(database, child, childSpec);
  }
}

/**
 * Writes a KDBX 4 (Argon2d) database for tests in other packages: the root
 * group takes `root`'s name, entries, and child groups, and one entry is
 * deleted so the recycle bin holds it.
 */
export async function createKeepassTestDatabase(input: {
  readonly name: string;
  readonly password: string;
  readonly root: KeepassTestGroup;
}): Promise<Uint8Array> {
  installArgon2();
  const credentials = new KdbxCredentials(
    ProtectedValue.fromString(input.password),
  );
  await credentials.ready;
  const database = KdbxDatabase.create(credentials, input.name);
  database.setVersion(4);
  database.setKdf(Consts.KdfId.Argon2d);
  const root = database.getDefaultGroup();
  root.name = input.root.name;
  addEntries(database, root, input.root);
  const discarded = database.createEntry(root);
  discarded.fields.set("Title", "Discarded");
  database.remove(discarded);
  return new Uint8Array(await database.save());
}
