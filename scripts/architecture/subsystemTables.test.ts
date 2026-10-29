import { expect, test } from "bun:test";
import * as ts from "typescript";
import { findTableViolations } from "./subsystemTables";
import {
  findTableUsesInProgram,
  rawSqlTableAccess,
} from "./subsystemTableUses";
import type { Subsystem } from "./subsystemTypes";

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

/** Type-checks fixture files in memory, with the real default library. */
function fixtureUses(files: Readonly<Record<string, readonly string[]>>) {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options);
  const readHostFile = host.getSourceFile.bind(host);
  const hostFileExists = host.fileExists.bind(host);
  host.getSourceFile = (fileName, languageVersion) => {
    const lines = files[fileName];
    return lines === undefined
      ? readHostFile(fileName, languageVersion)
      : ts.createSourceFile(fileName, lines.join("\n"), languageVersion, true);
  };
  host.fileExists = (fileName) => fileName in files || hostFileExists(fileName);
  const names = Object.keys(files);
  const hostDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (directory) =>
    names.some((fileName) => fileName.startsWith(`${directory}/`)) ||
    (hostDirectoryExists?.(directory) ?? false);
  return findTableUsesInProgram(ts.createProgram(names, options, host), names);
}

const fixtureRegistry = [
  subsystem("Alpha", ["/fixture/a/"], ["alphaRows"]),
  subsystem(
    "Beta",
    ["/fixture/b/"],
    ["betaLog", "betaRows", "cycleARows", "cycleBRows", "extraRows"],
    ["betaLog"],
  ),
  subsystem("Runtime", ["/fixture/sqlite/"]),
];

const schemaFixtures: Record<string, readonly string[]> = {
  "/fixture/sqlite/schema/index.ts": [
    'export const alphaRows = sqliteTable("alpha_rows", {});',
    'export const betaRows = sqliteTable("beta_rows", {});',
    'export const betaLog = sqliteTable("beta_log", {});',
    "export const appSchema = { alphaRows, betaLog, betaRows };",
  ],
  "/fixture/sqlite/schema/registry.ts": [
    'import { betaRows } from "./index";',
    "export const betaSchema = { betaRows };",
  ],
  "/fixture/sqlite/schema/other.ts": [
    'import { alphaRows } from "./index";',
    "export const otherSchema = { rows: alphaRows };",
  ],
  "/fixture/sqlite/schema/extra.ts": [
    'export const extraRows = sqliteTable("extra_rows", {});',
  ],
  "/fixture/sqlite/schema/alias.ts": [
    'export { betaRows as rows } from "./index";',
  ],
  "/fixture/sqlite/schema/aliasAgain.ts": ['export { rows } from "./alias";'],
  "/fixture/sqlite/schema/cycleA.ts": [
    'export * from "./cycleB";',
    'export const cycleARows = sqliteTable("cycle_a_rows", {});',
  ],
  "/fixture/sqlite/schema/cycleB.ts": [
    'export * from "./cycleA";',
    'export const cycleBRows = sqliteTable("cycle_b_rows", {});',
  ],
  "/fixture/sqlite/namespaceRuntime.ts": [
    'import * as extraTables from "./schema/extra";',
    'import * as aliasedTables from "./schema/alias";',
    "export const extraDb = drizzle(execute, { schema: extraTables });",
    "export const aliasedDb = drizzle(execute, { schema: aliasedTables });",
  ],
  "/fixture/sqlite/runtime.ts": [
    "declare function drizzle<S>(",
    "  execute: unknown,",
    "  options: { schema: S },",
    "): { query: { [K in keyof S]: { findMany(): unknown[] } } };",
    'import { appSchema } from "./schema";',
    "export const db = drizzle(execute, { schema: appSchema });",
    'export { appSchema } from "./schema";',
  ],
};

const useFixtures: Record<string, readonly string[]> = {
  "/fixture/a/own.ts": [
    'import { alphaRows } from "../sqlite/schema";',
    "export const own = tx.insert(alphaRows).values(row);",
  ],
  "/fixture/a/readsExposed.ts": [
    'import { betaLog } from "../sqlite/schema";',
    "export const x = tx.select({ at: betaLog.at }).from(betaLog);",
    'export const y = "SELECT at FROM beta_log";',
    "export type Row = typeof betaLog.$inferSelect;",
    "export const z = db.query.betaLog.findMany();",
  ],
  "/fixture/a/readsParenthesized.ts": [
    'import { appSchema } from "../sqlite/schema";',
    "const schema = (appSchema);",
    "export const x = tx.select().from((schema).betaLog as never);",
  ],
  "/fixture/a/readsDynamicExposed.ts": [
    'const { betaLog } = await import("../sqlite/schema");',
    "export const r = betaLog.at;",
  ],
  "/fixture/a/viaImport.ts": [
    'import { betaRows as rows } from "../sqlite/schema";',
    "export const x = tx.select().from(rows);",
  ],
  "/fixture/a/viaLoop.ts": [
    'import { betaLog } from "../sqlite/schema";',
    "for (const table of [betaLog]) await tx.delete(table).run();",
  ],
  "/fixture/a/viaShadowedAlias.ts": [
    'import { alphaRows, appSchema } from "../sqlite/schema";',
    "export function replaceBeta() {",
    "  const table = appSchema.betaRows;",
    "  const addAlpha = () => {",
    "    const table = alphaRows;",
    "    return tx.insert(table);",
    "  };",
    "  return [addAlpha(), tx.delete(table)];",
    "}",
  ],
  "/fixture/a/viaSchemaObject.ts": [
    'import { appSchema } from "../sqlite/schema";',
    "export const x = tx.update(appSchema.betaLog).set(row);",
  ],
  "/fixture/a/viaRuntimeReexport.ts": [
    'import { appSchema } from "../sqlite/runtime";',
    "export const x = tx.delete(appSchema.betaLog);",
  ],
  "/fixture/a/typesOnly.ts": [
    'import type { appSchema } from "../sqlite/schema";',
    "export type Schema = typeof appSchema;",
    "export interface Holder { readonly schema: Schema }",
  ],
  "/fixture/a/viaTypeName.ts": [
    'import * as schema from "../sqlite/schema";',
    "export type Row = typeof schema.betaRows.$inferSelect;",
  ],
  "/fixture/a/viaRelationalDestructure.ts": [
    "const { betaRows } = db.query;",
    "export const x = betaRows.findMany();",
  ],
  "/fixture/a/viaRelationalAlias.ts": [
    "const { query } = db;",
    "const { betaLog, ...rest } = query;",
    "export const x = [betaLog.findMany(), rest.betaRows.findMany()];",
  ],
  "/fixture/a/viaRelationalArgument.ts": [
    'import { db } from "../sqlite/runtime";',
    "export const x = listAll(db.query);",
  ],
  "/fixture/a/viaNamespaceQuery.ts": [
    'import { aliasedDb, extraDb } from "../sqlite/namespaceRuntime";',
    "export const x = extraDb.query.extraRows.findMany();",
    "export const y = aliasedDb.query.rows.findMany();",
  ],
  "/fixture/a/viaUntypedRelationalArgument.ts": [
    "declare const opaque: { readonly query: unknown };",
    "export const x = [listAll(db.query), listAll(opaque.query)];",
  ],
  "/fixture/a/readsSearchQuery.ts": [
    "declare const input: { readonly query: string };",
    "export const x = search(input.query);",
  ],
  "/fixture/a/viaColumnDestructure.ts": [
    'import { betaRows } from "../sqlite/schema";',
    "const { id } = betaRows;",
    "export const x = id;",
  ],
  "/fixture/a/viaParameterDefault.ts": [
    'import { betaRows } from "../sqlite/schema";',
    "export function clear(table = betaRows) {",
    "  return tx.delete(table);",
    "}",
  ],
  "/fixture/a/viaBindingDefault.ts": [
    'import { appSchema, betaLog } from "../sqlite/schema";',
    "const { alphaRows: table = betaLog } = appSchema;",
    "export const x = tx.insert(table);",
  ],
  "/fixture/a/viaComputedDestructure.ts": [
    'import { appSchema } from "../sqlite/schema";',
    "const { [name]: table } = appSchema;",
    "export const x = tx.insert(table);",
  ],
  "/fixture/a/aliasCycle.ts": [
    "let first = second;",
    "let second = first;",
    "const query = query;",
    "export const x = [tx.delete(first), second, query.betaRows];",
  ],
  "/fixture/a/viaLongAliasChain.ts": [
    'import { betaRows } from "../sqlite/schema";',
    "const alias0 = betaRows;",
    ...Array.from(
      { length: 24 },
      (_, index) => `const alias${index + 1} = alias${index};`,
    ),
    "export const x = tx.delete(alias24);",
    "const query0 = db.query;",
    ...Array.from(
      { length: 24 },
      (_, index) => `const query${index + 1} = query${index};`,
    ),
    "export const y = query24.extraRows.findMany();",
  ],
  "/fixture/a/viaValues.ts": [
    'import { appSchema } from "../sqlite/schema";',
    "for (const table of Object.values(appSchema)) await tx.delete(table);",
  ],
  "/fixture/a/viaAlias.ts": [
    'import { appSchema } from "../sqlite/schema";',
    "const schema = appSchema;",
    "export const x = tx.update(schema.betaLog).set(row);",
  ],
  "/fixture/a/viaComputedKey.ts": [
    'import { appSchema } from "../sqlite/schema";',
    "export const x = appSchema[name];",
  ],
  "/fixture/a/viaNamespace.ts": [
    'import * as registry from "../sqlite/schema/registry";',
    "export const x = registry.betaSchema.betaRows.id;",
  ],
  "/fixture/a/viaChainedAlias.ts": [
    'import { rows } from "../sqlite/schema/aliasAgain";',
    "export const x = tx.delete(rows);",
  ],
  "/fixture/a/viaCycleA.ts": [
    'import { cycleBRows } from "../sqlite/schema/cycleA";',
    "export const x = tx.delete(cycleBRows);",
  ],
  "/fixture/a/viaCycleB.ts": [
    'import { cycleARows } from "../sqlite/schema/cycleB";',
    "export const x = tx.delete(cycleARows);",
  ],
  "/fixture/a/viaRelationalIndex.ts": [
    'export const x = db.query["betaRows"].findMany();',
  ],
  "/fixture/a/viaRawSql.ts": ['export const x = "UPDATE beta_log SET at = ?";'],
  "/fixture/a/reexports.ts": [
    'export * from "../sqlite/schema";',
    'export * from "../sqlite/schema/extra";',
  ],
  "/fixture/a/viaReexport.ts": [
    'import { betaRows, extraRows } from "./reexports";',
    "export const x = [tx.delete(betaRows), tx.update(extraRows)];",
  ],
  "/fixture/a/viaDynamicNamespace.ts": [
    'const schema = await import("../sqlite/schema");',
    "export const x = schema.betaRows.id;",
  ],
  "/fixture/a/viaDynamicDestructure.ts": [
    'const { betaLog } = await import("../sqlite/schema");',
    "export const y = tx.delete(betaLog);",
  ],
  "/fixture/a/viaQuotedKey.ts": [
    'const { "betaRows": rows } = await import("../sqlite/schema");',
    "export const x = tx.delete(rows);",
  ],
  "/fixture/a/viaUnawaitedImport.ts": [
    'const pending = import("../sqlite/schema/extra");',
    "export const x = pending.then((m) => tx.delete(m.extraRows));",
  ],
};

const expectedViolations = [
  "/fixture/a/viaAlias.ts writes betaLog, which Beta owns",
  "/fixture/a/viaBindingDefault.ts writes betaLog, which Beta owns",
  "/fixture/a/viaChainedAlias.ts writes betaRows, which Beta owns",
  "/fixture/a/viaColumnDestructure.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaComputedDestructure.ts writes betaLog, which Beta owns",
  "/fixture/a/viaComputedDestructure.ts writes betaRows, which Beta owns",
  "/fixture/a/viaComputedKey.ts writes betaLog, which Beta owns",
  "/fixture/a/viaComputedKey.ts writes betaRows, which Beta owns",
  "/fixture/a/viaCycleA.ts writes cycleBRows, which Beta owns",
  "/fixture/a/viaCycleB.ts writes cycleARows, which Beta owns",
  "/fixture/a/viaDynamicDestructure.ts writes betaLog, which Beta owns",
  "/fixture/a/viaDynamicNamespace.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaImport.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaLongAliasChain.ts reads extraRows, which Beta does not expose for reading",
  "/fixture/a/viaLongAliasChain.ts writes betaRows, which Beta owns",
  "/fixture/a/viaLoop.ts writes betaLog, which Beta owns",
  "/fixture/a/viaNamespace.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaNamespaceQuery.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaNamespaceQuery.ts reads extraRows, which Beta does not expose for reading",
  "/fixture/a/viaParameterDefault.ts writes betaRows, which Beta owns",
  "/fixture/a/viaQuotedKey.ts writes betaRows, which Beta owns",
  "/fixture/a/viaRawSql.ts writes betaLog, which Beta owns",
  "/fixture/a/viaReexport.ts writes betaRows, which Beta owns",
  "/fixture/a/viaReexport.ts writes extraRows, which Beta owns",
  "/fixture/a/viaRelationalAlias.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaRelationalArgument.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaRelationalDestructure.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaRelationalIndex.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaRuntimeReexport.ts writes betaLog, which Beta owns",
  "/fixture/a/viaSchemaObject.ts writes betaLog, which Beta owns",
  "/fixture/a/viaShadowedAlias.ts writes betaRows, which Beta owns",
  "/fixture/a/viaTypeName.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaUnawaitedImport.ts writes extraRows, which Beta owns",
  "/fixture/a/viaUntypedRelationalArgument.ts reads betaRows, which Beta does not expose for reading",
  "/fixture/a/viaUntypedRelationalArgument.ts reads cycleARows, which Beta does not expose for reading",
  "/fixture/a/viaUntypedRelationalArgument.ts reads cycleBRows, which Beta does not expose for reading",
  "/fixture/a/viaUntypedRelationalArgument.ts reads extraRows, which Beta does not expose for reading",
  "/fixture/a/viaValues.ts writes betaLog, which Beta owns",
  "/fixture/a/viaValues.ts writes betaRows, which Beta owns",
];

test("every way of reaching another subsystem's table is classified and checked", () => {
  expect(
    findTableViolations({
      baseline: {},
      ...fixtureUses({ ...schemaFixtures, ...useFixtures }),
      registry: fixtureRegistry,
    }),
  ).toEqual(expectedViolations);
});

test("resolution does not depend on the order files are read", () => {
  const reversed = Object.fromEntries(
    Object.entries({ ...schemaFixtures, ...useFixtures }).reverse(),
  );
  expect(
    findTableViolations({
      baseline: {},
      ...fixtureUses(reversed),
      registry: fixtureRegistry,
    }),
  ).toEqual(expectedViolations);
});
