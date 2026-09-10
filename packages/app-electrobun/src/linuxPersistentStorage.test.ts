import { afterEach, expect, test } from "bun:test";
import {
  closeDatabase,
  deleteDatabase,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import {
  installOpfsMemoryShim,
  uninstallOpfsMemoryShim,
} from "../../sqlite-worker/tests/opfsMemoryShim";
import electrobunConfig from "../electrobun.config";

afterEach(() => {
  uninstallOpfsMemoryShim();
});

test("Linux CEF startup reopens encrypted OPFS storage", async () => {
  // Bun has no browser OPFS. The shared shim supplies its sync-access-handle
  // surface while the config assertion pins Linux to the CEF renderer that
  // provides that surface in the packaged app.
  expect(electrobunConfig.build.linux.bundleCEF).toBe(true);
  installOpfsMemoryShim();

  const options = {
    cipher: "chacha20" as const,
    dbName: `/electrobun-linux-${crypto.randomUUID()}.db`,
    key: "electrobun-linux-persistence-key",
    persistence: "opfs-sahpool" as const,
  };
  let db = await initDatabase(options);

  try {
    db.exec("CREATE TABLE startup_marker(value TEXT)");
    db.exec("INSERT INTO startup_marker VALUES ('persisted')");
    await closeDatabase(db);

    db = await initDatabase(options);
    expect(db.selectValue("SELECT value FROM startup_marker")).toBe(
      "persisted",
    );
  } finally {
    await deleteDatabase(db);
  }
});
