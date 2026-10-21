import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import * as ts from "typescript";
import { listProductionSourceFiles } from "./checkFactories";
import {
  registeredSubsystemSourcePaths,
  type Subsystem,
  subsystems,
} from "./subsystems";

export const subsystemTableBaselinePath =
  "scripts/architecture/subsystemTableBaseline.json";

// Schema modules declare tables or gather them into table lists; they are the
// SQLite Runtime's catalog, not users of another subsystem's data.
const schemaDirectoryPattern = /\/sqlite\/schema\//;
const testSupportFilePattern = /\.(test|testFixtures|testUtils)\.[cm]?[tj]sx?$/;
// Raw SQL names a table after one of these keywords; the SDK writes them upper
// case, so prose in strings and comments does not match.
const rawSqlTablePattern =
  /\b(?:FROM|JOIN|INTO|UPDATE)\s+["`]?([a-z][a-z0-9_]*)\b/g;
const resolvableSuffixes = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** A production file importing a declared table, or naming it in raw SQL. */
export interface SubsystemTableUse {
  from: string;
  table: string;
}

/** Table uses that predate ownership: table name -> importing files. */
export type SubsystemTableBaseline = Readonly<
  Record<string, readonly string[]>
>;

function matchesPath(filePath: string, path: string): boolean {
  return path.endsWith("/") ? filePath.startsWith(path) : filePath === path;
}

function ownerOfFile(
  registry: readonly Subsystem[],
  filePath: string,
): Subsystem | undefined {
  return registry.find((subsystem) =>
    subsystem.paths.some((path) => matchesPath(filePath, path)),
  );
}

function tableOwnershipViolations(
  registry: readonly Subsystem[],
  declaredTables: readonly string[],
): string[] {
  const declared = new Set(declaredTables);
  const unknown = registry.flatMap((subsystem) =>
    (subsystem.tables ?? [])
      .filter((table) => !declared.has(table))
      .map((table) => `${subsystem.name}: table ${table} is not declared`),
  );
  const owners = declaredTables.flatMap((table) => {
    const owning = registry.filter((subsystem) =>
      subsystem.tables?.includes(table),
    );
    if (owning.length === 1) return [];
    return owning.length === 0
      ? [`table ${table} is owned by no subsystem`]
      : [
          `table ${table} is owned by several subsystems (${owning.map((subsystem) => subsystem.name).join(", ")})`,
        ];
  });
  return [...unknown, ...owners];
}

/**
 * Uses of another subsystem's table that are not in the baseline, baseline
 * entries that no longer occur, and tables owned by no subsystem or several.
 */
export function findTableViolations(params: {
  baseline: SubsystemTableBaseline;
  declaredTables: readonly string[];
  registry: readonly Subsystem[];
  uses: readonly SubsystemTableUse[];
}): string[] {
  const crossUses = new Set<string>();
  const violations: string[] = [];
  for (const { from, table } of params.uses) {
    const owner = params.registry.find((subsystem) =>
      subsystem.tables?.includes(table),
    );
    const importer = ownerOfFile(params.registry, from);
    if (owner === undefined || importer === undefined || importer === owner) {
      continue;
    }
    crossUses.add(`${from} -> ${table}`);
    if (!params.baseline[table]?.includes(from)) {
      violations.push(`${from} uses ${table}, which ${owner.name} owns`);
    }
  }
  for (const [table, importers] of Object.entries(params.baseline)) {
    for (const from of importers) {
      if (!crossUses.has(`${from} -> ${table}`)) {
        violations.push(
          `${from} -> ${table} no longer occurs; delete it from ${subsystemTableBaselinePath}`,
        );
      }
    }
  }
  return [
    ...violations.sort(),
    ...tableOwnershipViolations(params.registry, params.declaredTables),
  ];
}

function resolveRelativeImport(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = normalize(join(dirname(from), specifier.replace(/\.js$/, "")));
  return [base, ...resolvableSuffixes.map((suffix) => `${base}${suffix}`)].find(
    (candidate) => files.has(candidate),
  );
}

/** Each `sqliteTable` export in the file, with the SQL name it declares. */
function declaredTables(
  source: ts.SourceFile,
): { name: string; sqlName: string | undefined }[] {
  return source.statements.flatMap((statement) => {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      return [];
    }
    return statement.declarationList.declarations.flatMap((declaration) => {
      const call = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        call === undefined ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        call.expression.text !== "sqliteTable"
      ) {
        return [];
      }
      const [sqlName] = call.arguments;
      return [
        {
          name: declaration.name.text,
          sqlName:
            sqlName !== undefined && ts.isStringLiteral(sqlName)
              ? sqlName.text
              : undefined,
        },
      ];
    });
  });
}

/** Table names that raw SQL in the file's string and template literals reads or writes. */
export function rawSqlTableNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const match of node.text.matchAll(rawSqlTablePattern)) {
        if (match[1] !== undefined) names.add(match[1]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function importedNames(
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): string[] {
  const bindings = ts.isImportDeclaration(statement)
    ? statement.importClause?.namedBindings
    : statement.exportClause;
  if (bindings === undefined) return ["*"];
  if (ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings)) {
    return ["*"];
  }
  return bindings.elements.map(
    (element) => (element.propertyName ?? element.name).text,
  );
}

async function readTableSources(): Promise<Map<string, ts.SourceFile>> {
  const tablePackages = new Set(
    subsystems
      .filter((subsystem) => subsystem.tables !== undefined)
      .map((subsystem) => subsystem.package),
  );
  const files = (
    await Promise.all(
      registeredSubsystemSourcePaths.map(listProductionSourceFiles),
    )
  )
    .flat()
    .filter((filePath) => {
      const owner = ownerOfFile(subsystems, filePath);
      return (
        owner !== undefined &&
        tablePackages.has(owner.package) &&
        !testSupportFilePattern.test(filePath)
      );
    });
  return new Map(
    await Promise.all(
      files.map(
        async (filePath) =>
          [
            filePath,
            ts.createSourceFile(
              filePath,
              await readFile(filePath, "utf8"),
              ts.ScriptTarget.Latest,
              true,
            ),
          ] as const,
      ),
    ),
  );
}

interface SchemaCatalog {
  readonly isSchemaModule: (filePath: string) => boolean;
  readonly tables: ReadonlySet<string>;
  readonly tablesByFile: ReadonlyMap<string, readonly string[]>;
  readonly tablesBySqlName: ReadonlyMap<string, string>;
}

function readSchemaCatalog(
  sources: ReadonlyMap<string, ts.SourceFile>,
): SchemaCatalog {
  const declarationsByFile = new Map(
    [...sources]
      .map(([filePath, source]) => [filePath, declaredTables(source)] as const)
      .filter(([, declarations]) => declarations.length > 0),
  );
  const tablesByFile = new Map(
    [...declarationsByFile].map(([filePath, declarations]) => [
      filePath,
      declarations.map((declaration) => declaration.name),
    ]),
  );
  return {
    isSchemaModule: (filePath) =>
      tablesByFile.has(filePath) || schemaDirectoryPattern.test(filePath),
    tables: new Set([...tablesByFile.values()].flat()),
    tablesByFile,
    tablesBySqlName: new Map(
      [...declarationsByFile.values()]
        .flat()
        .flatMap(({ name, sqlName }) =>
          sqlName === undefined ? [] : [[sqlName, name] as const],
        ),
    ),
  };
}

function importedTableUses(
  from: string,
  source: ts.SourceFile,
  catalog: SchemaCatalog,
  knownFiles: ReadonlySet<string>,
): SubsystemTableUse[] {
  return source.statements.flatMap((statement) => {
    if (
      !(
        ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
      ) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [];
    }
    const to = resolveRelativeImport(
      from,
      statement.moduleSpecifier.text,
      knownFiles,
    );
    if (to === undefined || !catalog.isSchemaModule(to)) return [];
    return importedNames(statement).flatMap((name) =>
      name === "*"
        ? (catalog.tablesByFile.get(to) ?? []).map((table) => ({ from, table }))
        : catalog.tables.has(name)
          ? [{ from, table: name }]
          : [],
    );
  });
}

async function readTableUses(): Promise<{
  declaredTables: string[];
  uses: SubsystemTableUse[];
}> {
  const sources = await readTableSources();
  const catalog = readSchemaCatalog(sources);
  const knownFiles = new Set(sources.keys());
  const uses = new Map<string, SubsystemTableUse>();
  for (const [from, source] of sources) {
    if (catalog.isSchemaModule(from)) continue;
    const rawSqlUses = [...rawSqlTableNames(source)].flatMap((sqlName) => {
      const table = catalog.tablesBySqlName.get(sqlName);
      return table === undefined ? [] : [{ from, table }];
    });
    for (const use of [
      ...importedTableUses(from, source, catalog, knownFiles),
      ...rawSqlUses,
    ]) {
      uses.set(`${use.from} -> ${use.table}`, use);
    }
  }
  return { declaredTables: [...catalog.tables], uses: [...uses.values()] };
}

export async function findSubsystemTableViolations(): Promise<string[]> {
  const baseline = JSON.parse(
    await readFile(subsystemTableBaselinePath, "utf8"),
  ) as SubsystemTableBaseline;
  return findTableViolations({
    baseline,
    ...(await readTableUses()),
    registry: subsystems,
  });
}
