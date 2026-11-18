import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readResetSchema(root: string) {
  const folder = join(root, "packages/api-shared/drizzle");
  const files = new Set(
    readdirSync(folder).filter((name) => name.endsWith(".sql")),
  );
  const journal = JSON.parse(
    readFileSync(join(folder, "meta/_journal.json"), "utf8"),
  );
  if (!Array.isArray(journal.entries) || !journal.entries.length)
    throw new Error("Empty or malformed reset migration journal.");

  const migrations: [number, string][] = [];
  let previousTime = 0;
  for (const [index, entry] of journal.entries.entries()) {
    const file = `${entry.tag}.sql`;
    if (
      entry.idx !== index ||
      typeof entry.tag !== "string" ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= previousTime ||
      !files.delete(file)
    ) {
      throw new Error(
        `Invalid reset migration journal entry at index ${index}.`,
      );
    }
    const sql = readFileSync(join(folder, file));
    migrations.push([
      entry.when,
      createHash("sha256").update(sql).digest("hex"),
    ]);
    previousTime = entry.when;
  }
  if (files.size)
    throw new Error(
      "SQL migrations are missing from the reset migration journal.",
    );

  const last = String(migrations.length - 1).padStart(4, "0");
  const snapshot = JSON.parse(
    readFileSync(join(folder, "meta", `${last}_snapshot.json`), "utf8"),
  );
  const names = Object.keys(snapshot.tables)
    .map((key) => {
      const table = snapshot.tables[key];
      if (
        typeof table.name !== "string" ||
        !/^[a-z_][a-z_0-9]*$/.test(table.name) ||
        key !== `public.${table.name}` ||
        (table.schema !== "" && table.schema !== "public")
      )
        throw new Error("Unsupported table in the reset migration snapshot.");
      return String(table.name);
    })
    .sort();
  if (!names.length)
    throw new Error("No application tables in the reset migration snapshot.");
  return { names, migrations };
}
