import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { object } from "./softResetPlans";

export interface ResetSchema {
  readonly names: string[];
  readonly migrations: [number, string][];
}

export function readResetSchema(root: string): ResetSchema {
  const folder = join(root, "packages/api-shared/drizzle");
  const files = new Set(
    readdirSync(folder).filter((name) => name.endsWith(".sql")),
  );
  const { entries } = object(
    JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")),
  );
  if (!Array.isArray(entries) || !entries.length)
    throw new Error("Empty or malformed reset migration journal.");

  const migrations: [number, string][] = [];
  let previousTime = 0;
  for (const [index, value] of entries.entries()) {
    const { idx, tag, when } = object(value);
    const file = `${tag}.sql`;
    if (
      idx !== index ||
      typeof tag !== "string" ||
      typeof when !== "number" ||
      !Number.isSafeInteger(when) ||
      when <= previousTime ||
      !files.delete(file)
    ) {
      throw new Error(
        `Invalid reset migration journal entry at index ${index}.`,
      );
    }
    // Drizzle records SHA-256 of the complete SQL file, including breakpoints.
    const sql = readFileSync(join(folder, file));
    migrations.push([when, createHash("sha256").update(sql).digest("hex")]);
    previousTime = when;
  }
  if (files.size)
    throw new Error(
      "SQL migrations are missing from the reset migration journal.",
    );

  const last = String(migrations.length - 1).padStart(4, "0");
  const { tables } = object(
    JSON.parse(
      readFileSync(join(folder, "meta", `${last}_snapshot.json`), "utf8"),
    ),
  );
  const names = Object.entries(object(tables))
    .map(([key, value]) => {
      const { name, schema } = object(value);
      if (
        typeof name !== "string" ||
        !/^[a-z_][a-z_0-9]*$/.test(name) ||
        key !== `public.${name}` ||
        (schema !== "" && schema !== "public")
      )
        throw new Error("Unsupported table in the reset migration snapshot.");
      return name;
    })
    .sort();
  if (!names.length)
    throw new Error("No application tables in the reset migration snapshot.");
  return { names, migrations };
}
