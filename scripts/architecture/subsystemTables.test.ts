import { expect, test } from "bun:test";
import * as ts from "typescript";
import type { Subsystem } from "./subsystems";
import { findTableViolations } from "./subsystemTables";
import {
  findTableUsesInSources,
  rawSqlTableAccess,
} from "./subsystemTableUses";

function subsystem(
  name: string,
  paths: readonly string[],
  tables?: readonly string[],
  readableTables?: readonly string[],
): Subsystem {
  return {
    name,
    package: "fixture",
    paths,
    responsibility: name,
    seam: name,
    ...(tables ? { tables } : {}),
    ...(readableTables ? { readableTables } : {}),
  };
}

const registry = [
  subsystem("Alpha", ["pkg/a/"], ["alphaRows"]),
  subsystem("Beta", ["pkg/b/"], ["betaRows", "betaLog"], ["betaLog"]),
  subsystem("Runtime", ["pkg/runtime/"]),
];
const declaredTables = ["alphaRows", "betaLog", "betaRows"];

test("a subsystem using its own tables, or reading an exposed one, passes", () => {
  expect(
    findTableViolations({
      baseline: {},
      declaredTables,
      registry,
      uses: [
        { access: "write", from: "pkg/a/store.ts", table: "alphaRows" },
        { access: "write", from: "pkg/b/log.ts", table: "betaLog" },
        { access: "read", from: "pkg/a/history.ts", table: "betaLog" },
      ],
    }),
  ).toEqual([]);
});

test("writes and unexposed reads fail unless the use is baselined", () => {
  const uses = [
    { access: "write", from: "pkg/a/history.ts", table: "betaLog" },
    { access: "read", from: "pkg/a/store.ts", table: "betaRows" },
    { access: "write", from: "pkg/runtime/exec.ts", table: "alphaRows" },
  ] as const;

  expect(
    findTableViolations({ baseline: {}, declaredTables, registry, uses }),
  ).toEqual([
    "pkg/a/history.ts writes betaLog, which Beta owns",
    "pkg/a/store.ts reads betaRows, which Beta does not expose for reading",
    "pkg/runtime/exec.ts writes alphaRows, which Alpha owns",
  ]);
  expect(
    findTableViolations({
      baseline: {
        alphaRows: ["pkg/runtime/exec.ts"],
        betaLog: ["pkg/a/history.ts"],
        betaRows: ["pkg/a/store.ts"],
      },
      declaredTables,
      registry,
      uses,
    }),
  ).toEqual([]);
});

test("a baseline entry that no longer occurs fails", () => {
  expect(
    findTableViolations({
      baseline: { betaLog: ["pkg/a/history.ts"] },
      declaredTables,
      registry,
      uses: [{ access: "read", from: "pkg/a/history.ts", table: "betaLog" }],
    }),
  ).toEqual([
    "pkg/a/history.ts -> betaLog no longer occurs; delete it from scripts/architecture/subsystemTableBaseline.json",
  ]);
});

test("every declared table has exactly one owner", () => {
  expect(
    findTableViolations({
      baseline: {},
      declaredTables: ["alphaRows", "orphanRows", "sharedRows"],
      registry: [
        subsystem(
          "Alpha",
          ["pkg/a/"],
          ["alphaRows", "sharedRows", "ghost"],
          ["orphanRows"],
        ),
        subsystem("Beta", ["pkg/b/"], ["sharedRows"]),
      ],
      uses: [],
    }),
  ).toEqual([
    "Alpha: table ghost is not declared",
    "Alpha: readable table orphanRows is not one of its tables",
    "table orphanRows is owned by no subsystem",
    "table sharedRows is owned by several subsystems (Alpha, Beta)",
  ]);
});

function parse(fileName: string, lines: readonly string[]): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    lines.join("\n"),
    ts.ScriptTarget.Latest,
    true,
  );
}

test("raw SQL reads and writes its tables; prose and comments name none", () => {
  const source = parse("fixture.ts", [
    'const read = "SELECT id FROM containers WHERE id = ?";',
    `const join = \`SELECT * FROM documents d LEFT JOIN document_projection p ON \${on}\`;`,
    `const write = sql\`INSERT OR IGNORE INTO "local_intents" (id) VALUES (\${id})\`;`,
    'const clear = "DELETE FROM documents WHERE id = ?";',
    'const prose = "removed from documents and update containers";',
    "// UPDATE principal_policies SET version = 1",
  ]);

  expect(Object.fromEntries(rawSqlTableAccess(source))).toEqual({
    containers: "read",
    document_projection: "read",
    documents: "write",
    local_intents: "write",
  });
});

test("every way of reaching another subsystem's table is classified and checked", () => {
  const sources = new Map(
    [
      parse("pkg/sqlite/schema/index.ts", [
        'export const alphaRows = sqliteTable("alpha_rows", {});',
        'export const betaRows = sqliteTable("beta_rows", {});',
        'export const betaLog = sqliteTable("beta_log", {});',
        "export const appSchema = { alphaRows, betaLog, betaRows };",
      ]),
      parse("pkg/sqlite/schema/registry.ts", [
        'import { betaRows } from "./index";',
        "export const betaSchema = { betaRows };",
      ]),
      parse("pkg/sqlite/schema/extra.ts", [
        'export const extraRows = sqliteTable("extra_rows", {});',
      ]),
      parse("pkg/sqlite/schema/alias.ts", [
        'export { betaRows as rows } from "./index";',
      ]),
      parse("pkg/sqlite/schema/aliasAgain.ts", [
        'export { rows } from "./alias";',
      ]),
      parse("pkg/sqlite/runtime.ts", [
        'import { appSchema } from "./schema";',
        "export const db = drizzle(execute, { schema: appSchema });",
        'export { appSchema } from "./schema";',
      ]),
      parse("pkg/a/own.ts", [
        'import { alphaRows } from "../sqlite/schema";',
        "export const own = tx.insert(alphaRows).values(row);",
      ]),
      parse("pkg/a/readsExposed.ts", [
        'import { betaLog } from "../sqlite/schema";',
        "export const x = tx.select({ at: betaLog.at }).from(betaLog);",
        'export const y = "SELECT at FROM beta_log";',
        "export type Row = typeof betaLog.$inferSelect;",
        "export const z = db.query.betaLog.findMany();",
      ]),
      parse("pkg/a/readsDynamicExposed.ts", [
        'const { betaLog } = await import("../sqlite/schema");',
        "export const r = betaLog.at;",
      ]),
      parse("pkg/a/viaImport.ts", [
        'import { betaRows as rows } from "../sqlite/schema";',
        "export const x = tx.select().from(rows);",
      ]),
      parse("pkg/a/viaLoop.ts", [
        'import { betaLog } from "../sqlite/schema";',
        "for (const table of [betaLog]) await tx.delete(table).run();",
      ]),
      parse("pkg/a/viaSchemaObject.ts", [
        'import { appSchema } from "../sqlite/schema";',
        "export const x = tx.update(appSchema.betaLog).set(row);",
      ]),
      parse("pkg/a/viaRuntimeReexport.ts", [
        'import { appSchema } from "../sqlite/runtime";',
        "export const x = tx.delete(appSchema.betaLog);",
      ]),
      parse("pkg/a/viaAlias.ts", [
        'import { appSchema } from "../sqlite/schema";',
        "const schema = appSchema;",
        "export const x = tx.update(schema.betaLog).set(row);",
      ]),
      parse("pkg/a/viaComputedKey.ts", [
        'import { appSchema } from "../sqlite/schema";',
        "export const x = appSchema[name];",
      ]),
      parse("pkg/a/viaNamespace.ts", [
        'import * as registry from "../sqlite/schema/registry";',
        "export const x = registry.betaSchema.betaRows.id;",
      ]),
      parse("pkg/a/viaChainedAlias.ts", [
        'import { rows } from "../sqlite/schema/aliasAgain";',
        "export const x = tx.delete(rows);",
      ]),
      parse("pkg/a/viaRelationalIndex.ts", [
        'export const x = db.query["betaRows"].findMany();',
      ]),
      parse("pkg/a/viaRawSql.ts", [
        'export const x = "UPDATE beta_log SET at = ?";',
      ]),
      parse("pkg/a/reexports.ts", [
        'export * from "../sqlite/schema";',
        'export * from "../sqlite/schema/extra";',
      ]),
      parse("pkg/a/viaReexport.ts", [
        'import { betaRows, extraRows } from "./reexports";',
        "export const x = [tx.delete(betaRows), tx.update(extraRows)];",
      ]),
      parse("pkg/a/viaDynamicNamespace.ts", [
        'const schema = await import("../sqlite/schema");',
        "export const x = schema.betaRows.id;",
      ]),
      parse("pkg/a/viaDynamicDestructure.ts", [
        'const { betaLog } = await import("../sqlite/schema");',
        "export const y = tx.delete(betaLog);",
      ]),
      parse("pkg/a/viaQuotedKey.ts", [
        'const { "betaRows": rows } = await import("../sqlite/schema");',
        "export const x = tx.delete(rows);",
      ]),
      parse("pkg/a/viaUnawaitedImport.ts", [
        'const pending = import("../sqlite/schema/extra");',
        "export const x = pending.then((m) => tx.delete(m.extraRows));",
      ]),
    ].map((source) => [source.fileName, source] as const),
  );
  const registry = [
    subsystem("Alpha", ["pkg/a/"], ["alphaRows"]),
    subsystem(
      "Beta",
      ["pkg/b/"],
      ["betaRows", "betaLog", "extraRows"],
      ["betaLog"],
    ),
    subsystem("Runtime", ["pkg/sqlite/"]),
  ];

  expect(
    findTableViolations({
      baseline: {},
      ...findTableUsesInSources(sources),
      registry,
    }),
  ).toEqual([
    "pkg/a/viaAlias.ts writes betaLog, which Beta owns",
    "pkg/a/viaChainedAlias.ts writes betaRows, which Beta owns",
    "pkg/a/viaComputedKey.ts writes betaLog, which Beta owns",
    "pkg/a/viaComputedKey.ts writes betaRows, which Beta owns",
    "pkg/a/viaDynamicDestructure.ts writes betaLog, which Beta owns",
    "pkg/a/viaDynamicNamespace.ts reads betaRows, which Beta does not expose for reading",
    "pkg/a/viaImport.ts reads betaRows, which Beta does not expose for reading",
    "pkg/a/viaLoop.ts writes betaLog, which Beta owns",
    "pkg/a/viaNamespace.ts reads betaRows, which Beta does not expose for reading",
    "pkg/a/viaQuotedKey.ts writes betaRows, which Beta owns",
    "pkg/a/viaRawSql.ts writes betaLog, which Beta owns",
    "pkg/a/viaReexport.ts writes betaRows, which Beta owns",
    "pkg/a/viaReexport.ts writes extraRows, which Beta owns",
    "pkg/a/viaRelationalIndex.ts reads betaRows, which Beta does not expose for reading",
    "pkg/a/viaRuntimeReexport.ts writes betaLog, which Beta owns",
    "pkg/a/viaSchemaObject.ts writes betaLog, which Beta owns",
    "pkg/a/viaUnawaitedImport.ts writes extraRows, which Beta owns",
  ]);
});
