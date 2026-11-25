# @tearleads/keepass

Reads a KeePass 2 database (`.kdbx`, as written by KeePassXC, KeePassX 2, and
KeePass) into plain records: a tree of groups and their entries, with every
protected value decrypted to a string. The
[CLI](../cli/README.md#restore-a-keepass-database)'s `restore-keepass` command
uses it to restore a database into Tearleads as folders of passcodes.

```ts
import { readKeepassDatabase } from "@tearleads/keepass";

const database = await readKeepassDatabase(bytes, { password, keyFile });
database.root.groups; // child groups, recursively
database.root.entries; // title, username, password, url, notes, ...
```

It wraps [kdbxweb](https://github.com/keeweb/kdbxweb) and supplies kdbxweb's
Argon2 through [hash-wasm](https://github.com/Daninet/hash-wasm), so it opens
KDBX 3.1 (AES-KDF) and KDBX 4 (Argon2d, Argon2id, or AES-KDF) databases
encrypted with AES or ChaCha20. Twofish-encrypted databases and KeePass 1.x
`.kdb` files are not supported.

- The recycle bin and everything in it are left out and counted in `skipped`.
- Standard fields become `title`, `username`, `password`, `url`, and `notes`;
  every other string field is a `customFields` entry that keeps KeePass's
  protect-in-memory flag. Attachments are listed by name and size.
- A blank password counts as no password, as KeePass treats it; a key file
  alone is accepted.
- Failures are `KeepassReadError`s with a `code` (`wrong-key`, `not-kdbx`,
  `unsupported`, `corrupt`, `too-large`, `no-credentials`) and a message meant
  for the person running the import.

The package depends on no other workspace package (the `keepass-stays-leaf`
architecture rule), so it can be reused or removed on its own.

## Tests

```sh
bun run --cwd packages/keepass test
```

One fixture is a database written by KeePassXC 2.7.4, embedded as base64 in
`src/keepassxcFixture.testUtils.ts`; the KDBX 4 cases are generated with
kdbxweb, and the Argon2 adapter is checked against tags computed with
`@noble/hashes`.
