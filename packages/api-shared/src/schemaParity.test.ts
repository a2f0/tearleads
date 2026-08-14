import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

interface ColumnSnapshot {
  readonly autoincrement?: boolean;
  readonly identity?: object;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
}

interface IndexSnapshot {
  readonly columns: readonly (string | { readonly expression: string })[];
  readonly isUnique?: boolean;
  readonly where?: string;
}

interface ForeignKeySnapshot {
  readonly columnsFrom: readonly string[];
  readonly columnsTo: readonly string[];
  readonly onDelete: string;
  readonly onUpdate: string;
  readonly tableTo: string;
}

interface CheckSnapshot {
  readonly value: string;
}

interface TableSnapshot {
  readonly checkConstraints: Record<string, CheckSnapshot>;
  readonly columns: Record<string, ColumnSnapshot>;
  readonly foreignKeys: Record<string, ForeignKeySnapshot>;
  readonly indexes: Record<string, IndexSnapshot>;
  readonly name: string;
  readonly uniqueConstraints?: Record<string, IndexSnapshot>;
}

interface SchemaSnapshot {
  readonly tables: Record<string, TableSnapshot>;
}

interface MigrationJournal {
  readonly entries: readonly { readonly idx: number }[];
}

function metaDirectory(dialect: "postgres" | "sqlite"): string {
  const directory = dialect === "postgres" ? "drizzle" : "drizzle-sqlite";
  return fileURLToPath(new URL(`../${directory}/meta/`, import.meta.url));
}

async function latestSnapshot(
  dialect: "postgres" | "sqlite",
): Promise<SchemaSnapshot> {
  const directory = metaDirectory(dialect);
  const journal = JSON.parse(
    await readFile(`${directory}_journal.json`, "utf8"),
  ) as MigrationJournal;
  const latest = journal.entries.at(-1);
  if (!latest) {
    throw new Error(`Missing ${dialect} migration journal entries`);
  }

  const index = String(latest.idx).padStart(4, "0");
  return JSON.parse(
    await readFile(`${directory}${index}_snapshot.json`, "utf8"),
  ) as SchemaSnapshot;
}

function indexColumns(index: IndexSnapshot): string[] {
  return index.columns.map((column) =>
    typeof column === "string" ? column : column.expression,
  );
}

function normalizeTable(table: TableSnapshot) {
  const columns = Object.fromEntries(
    Object.entries(table.columns)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, column]) => [
        name,
        {
          generatedIdentity: Boolean(column.identity ?? column.autoincrement),
          notNull: column.notNull,
          primaryKey: column.primaryKey,
        },
      ]),
  );
  const indexes = [
    ...Object.entries(table.indexes).map(([name, index]) => ({
      columns: indexColumns(index),
      isUnique: index.isUnique ?? false,
      name,
      where: index.where ?? null,
    })),
    ...Object.entries(table.uniqueConstraints ?? {}).map(([name, index]) => ({
      columns: indexColumns(index),
      isUnique: true,
      name,
      where: index.where ?? null,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const foreignKeys = Object.entries(table.foreignKeys)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, foreignKey]) => ({ name, ...foreignKey }));
  const checks = Object.entries(table.checkConstraints)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, check]) => ({ name, value: check.value }));

  return { checks, columns, foreignKeys, indexes };
}

function normalizeSchema(snapshot: SchemaSnapshot) {
  return Object.fromEntries(
    Object.values(snapshot.tables)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((table) => [table.name, normalizeTable(table)]),
  );
}

test("Postgres and SQLite migrations match table constraints and columns", async () => {
  const [postgres, sqlite] = await Promise.all([
    latestSnapshot("postgres"),
    latestSnapshot("sqlite"),
  ]);

  expect(normalizeSchema(sqlite)).toEqual(normalizeSchema(postgres));
});
