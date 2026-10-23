# Encrypted database compatibility fixture

`cipher251.json` is a base64 OPFS snapshot produced by the official
[SQLite3MC 2.5.1 / SQLite 3.53.4 wasm archive](https://github.com/utelle/SQLite3MultipleCiphers/releases/tag/v2.5.1).
The archive SHA256 is
`761a41b8dc996cfa21f193fc044739fbb0c4a31a1fd657a4df49cc59085577ce`;
its `sqlite3.wasm` SHA256 is
`b6aedab9eee5cd5de0f13498e0bf64bb5ee9cc786d1d0303cc365578b64d18ab`.
client-sdk 0.1.50 and 0.1.85 shipped this same wasm, so the fixture stands in
for databases those releases persisted.

It uses the test OPFS shim and the production SAHPool naming and cipher VFS.
The database is `/upgrade-2.5.1.db`. Its public fixture passphrase is
`upgrade-fixture-key`; no real user data or credentials are included.
The 2.5.1 runtime executed:

```sql
PRAGMA page_size=4096;
PRAGMA cipher='chacha20';
PRAGMA key='upgrade-fixture-key';
CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);
INSERT INTO notes VALUES(1, 'persisted before runtime upgrade');
```

The explicit page size keeps this fixture compact. Cipher legacy mode,
key derivation, salt, and header settings keep the 2.5.1 runtime defaults.
After closing the database and pausing its pool, the snapshot preserves the
allocated backing file including its SAHPool header; unused pool files are
omitted. `cipherUpgrade.test.ts` mounts these persisted bytes through the current
production loader, rejects a wrong key, reads the original row, updates it, and
reopens it without resetting storage. Integrity checks run before and after.

Keep these bytes when upgrading the runtime. Regenerating the fixture with a
newer runtime would stop testing backward compatibility. If an intended
format migration is required, add explicit migration coverage and retain this
fixture as its input.
