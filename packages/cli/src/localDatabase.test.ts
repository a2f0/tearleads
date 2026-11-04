import { expect, test } from "bun:test";
import { isOpfsInstallWarning, openLocalDatabase } from "./localDatabase";

test("only SQLite's OPFS install warnings are filtered", () => {
  expect(
    isOpfsInstallWarning([
      "Ignoring inability to install 'opfs' sqlite3_vfs: TypeError: x",
    ]),
  ).toBe(true);
  expect(
    isOpfsInstallWarning([
      "Ignoring inability to install the",
      "opfs-wl",
      "sqlite3_vfs:",
      new Error("x"),
    ]),
  ).toBe(true);
  expect(isOpfsInstallWarning(["Ignoring inability to install kvvfs"])).toBe(
    false,
  );
  expect(isOpfsInstallWarning([new Error("opfs")])).toBe(false);
});

test("the in-memory database runs statements", async () => {
  const database = await openLocalDatabase();
  try {
    const result = await database.client.exec({
      sql: "select 1 as one",
      rowMode: "object",
    });
    expect(result.rows).toEqual([{ one: 1 }]);
  } finally {
    database.close();
  }
});
