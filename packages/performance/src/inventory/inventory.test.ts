import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInventoryCommand } from "./command";
import { findLeftPrefixDuplicateIndexes, type TableIndex } from "./indexes";
import { extractOpenApiOperations } from "./openapiInventory";
import { inventoryUsage, parseInventoryOptions } from "./options";
import { parsePostgresMigrations } from "./postgresSchema";
import { parseSqliteTablesFromSource } from "./sqliteSchema";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tearleads-inventory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("parseInventoryOptions", () => {
  test("returns defaults and parses --canaries and --json", () => {
    expect(parseInventoryOptions([])).toEqual({ json: false });
    expect(
      parseInventoryOptions(["--canaries", "report.json", "--json"]),
    ).toEqual({
      canariesReport: "report.json",
      json: true,
    });
    expect(parseInventoryOptions(["--help"])).toBeNull();
  });

  test("rejects unexpected positional arguments", () => {
    expect(() => parseInventoryOptions(["extra"])).toThrow(
      /Unexpected argument/u,
    );
  });
});

describe("findLeftPrefixDuplicateIndexes", () => {
  test("flags redundant non-unique left-prefix index but preserves unique and distinct-predicate indexes", () => {
    const indexes = new Map<string, TableIndex[]>([
      [
        "items",
        [
          {
            name: "items_pkey",
            table: "items",
            columns: ["id"],
            unique: true,
            primaryKey: true,
            predicate: null,
          },
          {
            name: "items_org_idx",
            table: "items",
            columns: ["org_id"],
            unique: false,
            primaryKey: false,
            predicate: null,
          },
          {
            name: "items_org_updated_idx",
            table: "items",
            columns: ["org_id", "updated_at"],
            unique: false,
            primaryKey: false,
            predicate: null,
          },
          {
            name: "items_org_unique_idx",
            table: "items",
            columns: ["org_id"],
            unique: true,
            primaryKey: false,
            predicate: null,
          },
          {
            name: "items_org_partial_idx",
            table: "items",
            columns: ["org_id"],
            unique: false,
            primaryKey: false,
            predicate: "deleted_at IS NULL",
          },
        ],
      ],
    ]);

    const leads = findLeftPrefixDuplicateIndexes(indexes);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      table: "items",
      indexName: "items_org_idx",
      coveredByName: "items_org_updated_idx",
    });
  });
});

describe("parsePostgresMigrations", () => {
  test("replays CREATE TABLE, ALTER TABLE ADD/DROP COLUMN, and CREATE/DROP INDEX", async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, "0000_init.sql"),
      `CREATE TABLE "widgets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "org_id" uuid NOT NULL,
  "legacy_col" text
);
--> statement-breakpoint
CREATE INDEX "widgets_org_idx" ON "widgets" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX "widgets_legacy_idx" ON "widgets" USING btree ("legacy_col");`,
    );
    await writeFile(
      join(dir, "0001_cleanup.sql"),
      `DROP INDEX "widgets_legacy_idx";--> statement-breakpoint
ALTER TABLE "widgets" DROP COLUMN "legacy_col";--> statement-breakpoint
ALTER TABLE "widgets" ADD COLUMN "updated_at" timestamp NOT NULL;--> statement-breakpoint
CREATE INDEX "widgets_org_updated_idx" ON "widgets" USING btree ("org_id","updated_at");`,
    );

    const parsed = await parsePostgresMigrations(dir);
    expect(parsed.migrationCount).toBe(2);
    const widgets = parsed.tables.get("widgets");
    expect(widgets?.columns).toEqual(["id", "org_id", "updated_at"]);
    expect(widgets?.indexes.map((idx) => idx.name)).toEqual([
      "widgets_org_idx",
      "widgets_org_updated_idx",
      "widgets_pkey",
    ]);
  });
});

describe("parseSqliteTablesFromSource", () => {
  test("parses columns, string constants, inline PK, composite PK, and indexes", () => {
    const source = `
const statusCol = "effective_status";
export const docs = sqliteTable(
  "docs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    status: text(statusCol).notNull(),
  },
  (table) => [
    index("docs_org_idx").on(table.orgId),
    uniqueIndex("docs_org_status_idx").on(table.orgId, table.status),
  ],
);`;

    const tables = parseSqliteTablesFromSource(source, "docs.ts", "sdk");
    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(table?.sqlTable).toBe("docs");
    expect(table?.columns.get("status")).toBe("effective_status");
    expect(table?.indexes.map((i) => i.name)).toEqual([
      "docs_pkey",
      "docs_org_idx",
      "docs_org_status_idx",
    ]);
  });
});

describe("extractOpenApiOperations", () => {
  test("resolves $ref, allOf, and array items to collect 2xx response fields", () => {
    const doc = {
      components: {
        schemas: {
          Item: {
            type: "object",
            properties: {
              id: { type: "string" },
              unusedEchoField: { type: "string" },
            },
          },
          ItemList: {
            allOf: [
              {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Item" },
                  },
                },
              },
            ],
          },
        },
      },
      paths: {
        "/items": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ItemList" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = extractOpenApiOperations(doc);
    expect(result.pathCount).toBe(1);
    expect(result.operationCount).toBe(1);
    expect(result.byMethod).toEqual({ GET: 1 });
    expect([...(result.fieldToRoutes.get("unusedEchoField") ?? [])]).toEqual([
      "GET /items",
    ]);
  });
});

describe("runInventoryCommand", () => {
  test("prints usage on --help", async () => {
    const printed: string[] = [];
    const code = await runInventoryCommand(["--help"], {
      repoRoot: await makeTempDir(),
      reportDirectory: await makeTempDir(),
      print: (line) => printed.push(line),
    });
    expect(code).toBe(0);
    expect(printed.join("\n")).toBe(inventoryUsage);
  });

  test("audits a minimal fixture repository and writes JSON + Markdown reports", async () => {
    const repo = await makeTempDir();
    const outDir = await makeTempDir();
    await mkdir(join(repo, "packages/api-shared/drizzle"), { recursive: true });
    await mkdir(join(repo, "packages/api-shared/src/schema"), {
      recursive: true,
    });
    await mkdir(join(repo, "packages/api/src"), { recursive: true });
    await mkdir(join(repo, "packages/client-sdk/src/data/sqlite/schema"), {
      recursive: true,
    });
    await mkdir(join(repo, "packages/app/src"), { recursive: true });
    await mkdir(join(repo, "packages/crypto/src"), { recursive: true });
    await mkdir(join(repo, "packages/validators/src/response"), {
      recursive: true,
    });
    await mkdir(join(repo, "docs"), { recursive: true });

    await writeFile(
      join(repo, "packages/api-shared/drizzle/0000_init.sql"),
      `CREATE TABLE "notes" ("id" uuid PRIMARY KEY NOT NULL, "title" text, "dead_col" text);
--> statement-breakpoint
CREATE INDEX "notes_title_idx" ON "notes" USING btree ("title");
--> statement-breakpoint
CREATE INDEX "notes_title_id_idx" ON "notes" USING btree ("title","id");`,
    );
    await writeFile(
      join(repo, "packages/api-shared/src/schema/notes.ts"),
      `export const notes = pgTable("notes", { id: uuid("id"), title: text("title"), deadCol: text("dead_col") });`,
    );
    await writeFile(
      join(repo, "packages/api/src/notesService.ts"),
      `export function readNotes() { return [notes.id, notes.title]; }`,
    );
    await writeFile(
      join(repo, "packages/client-sdk/src/data/sqlite/schema/notes.ts"),
      `export const localNotes = sqliteTable("local_notes", { id: text("id").primaryKey(), title: text("title") });`,
    );
    await writeFile(
      join(repo, "packages/client-sdk/src/notesStore.ts"),
      `export const q = [localNotes.id, localNotes.title];`,
    );
    await writeFile(
      join(repo, "packages/crypto/src/seal.ts"),
      `export const suite = "sealingSuite";`,
    );
    await writeFile(
      join(repo, "packages/validators/src/response/writerProjectionWire.ts"),
      `export const digest = "levelDigest";`,
    );
    await writeFile(
      join(repo, "docs/openapi.json"),
      JSON.stringify({
        paths: {
          "/notes": {
            get: {
              responses: {
                "200": {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          sealingSuite: { type: "string" },
                          levelDigest: { type: "string" },
                          neverReadField: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );

    const printed: string[] = [];
    const code = await runInventoryCommand(["--json"], {
      repoRoot: repo,
      reportDirectory: outDir,
      print: (line) => printed.push(line),
    });
    expect(code).toBe(0);
    const report = JSON.parse(printed.join("\n"));
    expect(report.postgres.tableCount).toBe(1);
    expect(report.postgres.duplicateIndexes).toHaveLength(1);
    expect(report.postgres.unreadColumns).toEqual([
      { table: "notes", sqlColumn: "dead_col", propertyName: "deadCol" },
    ]);
    expect(report.sqlite.sdkTableCount).toBe(1);
    expect(report.openapi.operationCount).toBe(1);
    expect(report.openapi.unreadResponseFields).toEqual([
      { field: "neverReadField", routes: ["GET /notes"] },
    ]);
  });
});
