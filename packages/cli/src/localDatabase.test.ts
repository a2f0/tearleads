import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
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

test("the OPFS warning filter is in place as soon as the module loads", async () => {
  // A fresh process, so no earlier test has opened a database.
  const modulePath = fileURLToPath(
    new URL("./localDatabase.ts", import.meta.url),
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `await import(${JSON.stringify(modulePath)});
       console.warn("Ignoring inability to install 'opfs' sqlite3_vfs:", "x");
       console.warn("kept");`,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [stderr, exitCode] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("kept\n");
});
