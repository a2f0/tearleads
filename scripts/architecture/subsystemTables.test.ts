import { expect, test } from "bun:test";
import * as ts from "typescript";
import type { Subsystem } from "./subsystems";
import { findTableViolations } from "./subsystemTables";
import {
  findTableUsesInSources,
  rawSqlTableNames,
  schemaKeysReadInSource,
} from "./subsystemTableUses";

function subsystem(
  name: string,
  paths: readonly string[],
  tables?: readonly string[],
): Subsystem {
  return {
    name,
    package: "fixture",
    paths,
    responsibility: name,
    seam: name,
    ...(tables ? { tables } : {}),
  };
}

const registry = [
  subsystem("Alpha", ["pkg/a/"], ["alphaRows"]),
  subsystem("Beta", ["pkg/b/"], ["betaRows", "betaLog"]),
  subsystem("Runtime", ["pkg/runtime/"]),
];
const declaredTables = ["alphaRows", "betaLog", "betaRows"];

test("a subsystem using its own tables passes", () => {
  expect(
    findTableViolations({
      baseline: {},
      declaredTables,
      registry,
      uses: [
        { from: "pkg/a/store.ts", table: "alphaRows" },
        { from: "pkg/b/log.ts", table: "betaLog" },
      ],
    }),
  ).toEqual([]);
});

test("another subsystem's table fails unless the use is baselined", () => {
  const uses = [
    { from: "pkg/a/store.ts", table: "betaRows" },
    { from: "pkg/runtime/exec.ts", table: "alphaRows" },
  ];

  expect(
    findTableViolations({ baseline: {}, declaredTables, registry, uses }),
  ).toEqual([
    "pkg/a/store.ts uses betaRows, which Beta owns",
    "pkg/runtime/exec.ts uses alphaRows, which Alpha owns",
  ]);
  expect(
    findTableViolations({
      baseline: {
        alphaRows: ["pkg/runtime/exec.ts"],
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
      baseline: { betaRows: ["pkg/a/store.ts"] },
      declaredTables,
      registry,
      uses: [{ from: "pkg/b/store.ts", table: "betaRows" }],
    }),
  ).toEqual([
    "pkg/a/store.ts -> betaRows no longer occurs; delete it from scripts/architecture/subsystemTableBaseline.json",
  ]);
});

test("every declared table has exactly one owner", () => {
  expect(
    findTableViolations({
      baseline: {},
      declaredTables: ["alphaRows", "orphanRows", "sharedRows"],
      registry: [
        subsystem("Alpha", ["pkg/a/"], ["alphaRows", "sharedRows", "ghost"]),
        subsystem("Beta", ["pkg/b/"], ["sharedRows"]),
      ],
      uses: [],
    }),
  ).toEqual([
    "Alpha: table ghost is not declared",
    "table orphanRows is owned by no subsystem",
    "table sharedRows is owned by several subsystems (Alpha, Beta)",
  ]);
});

test("raw SQL in strings and templates names its tables; prose and comments do not", () => {
  const source = ts.createSourceFile(
    "fixture.ts",
    [
      'const read = "SELECT id FROM containers WHERE id = ?";',
      `const join = \`SELECT * FROM documents d LEFT JOIN document_projection p ON \${on}\`;`,
      `const write = sql\`INSERT INTO "local_intents" (id) VALUES (\${id})\`;`,
      'const prose = "removed from documents and update containers";',
      "// SELECT * FROM principal_policies",
    ].join("\n"),
    ts.ScriptTarget.Latest,
    true,
  );

  expect([...rawSqlTableNames(source)].sort()).toEqual([
    "containers",
    "document_projection",
    "documents",
    "local_intents",
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

test("keys read off schema roots name tables; passing a root along does not", () => {
  const source = parse("fixture.ts", [
    "const a = schema.documents;",
    'const b = schema["containers"];',
    "const { localIntents, documentProjection: projection } = schema;",
    "const c = all.principalPolicies;",
    "const d = all.clientSQLiteSchema.securityIncidents;",
    'const e = all["clientSQLiteSchema"]["trustedUserIdentityPins"];',
    "await db.query.documentHistoryUpdates.findMany();",
    'await db.query["documentPendingAttachments"].findMany();',
    "const { verifiedAccessManifestBundles } = tx.query;",
    "const ignored = other.organizationFounders;",
    "const runtime = drizzle(execute, { schema });",
  ]);

  expect(
    [
      ...schemaKeysReadInSource(source, {
        namespaces: new Set(["all"]),
        objects: new Set(["schema"]),
        schemaObjectNames: new Set(["clientSQLiteSchema"]),
      }),
    ].sort(),
  ).toEqual([
    "clientSQLiteSchema",
    "containers",
    "documentHistoryUpdates",
    "documentPendingAttachments",
    "documentProjection",
    "documents",
    "localIntents",
    "principalPolicies",
    "securityIncidents",
    "trustedUserIdentityPins",
    "verifiedAccessManifestBundles",
  ]);
});

test("every way of reaching another subsystem's table is rejected", () => {
  const sources = new Map(
    [
      parse("pkg/sqlite/schema/index.ts", [
        'export const alphaRows = sqliteTable("alpha_rows", {});',
        'export const betaRows = sqliteTable("beta_rows", {});',
        "export const appSchema = { alphaRows, betaRows };",
      ]),
      parse("pkg/sqlite/schema/registry.ts", [
        'import { betaRows } from "./index";',
        "export const betaSchema = { betaRows };",
      ]),
      parse("pkg/sqlite/runtime.ts", [
        'import { appSchema } from "./schema";',
        "export const db = drizzle(execute, { schema: appSchema });",
      ]),
      parse("pkg/a/own.ts", [
        'import { alphaRows } from "../sqlite/schema";',
        "export const own = [alphaRows, db.query.alphaRows];",
      ]),
      parse("pkg/a/viaImport.ts", [
        'import { betaRows as rows } from "../sqlite/schema";',
        "export const x = rows;",
      ]),
      parse("pkg/a/viaSchemaObject.ts", [
        'import { appSchema } from "../sqlite/schema";',
        "export const x = appSchema.betaRows;",
      ]),
      parse("pkg/a/viaNamespace.ts", [
        'import * as registry from "../sqlite/schema/registry";',
        "export const x = registry.betaSchema.betaRows;",
      ]),
      parse("pkg/a/viaRelationalIndex.ts", [
        'export const x = db.query["betaRows"].findMany();',
      ]),
      parse("pkg/a/viaRawSql.ts", [
        'export const x = "SELECT id FROM beta_rows";',
      ]),
      parse("pkg/a/viaReexport.ts", ['export * from "../sqlite/schema";']),
    ].map((source) => [source.fileName, source] as const),
  );
  const registry = [
    subsystem("Alpha", ["pkg/a/"], ["alphaRows"]),
    subsystem("Beta", ["pkg/b/"], ["betaRows"]),
    subsystem("Runtime", ["pkg/sqlite/"]),
  ];

  expect(
    findTableViolations({
      baseline: {},
      ...findTableUsesInSources(sources),
      registry,
    }),
  ).toEqual(
    [
      "viaImport",
      "viaNamespace",
      "viaRawSql",
      "viaReexport",
      "viaRelationalIndex",
      "viaSchemaObject",
    ].map((file) => `pkg/a/${file}.ts uses betaRows, which Beta owns`),
  );
});
