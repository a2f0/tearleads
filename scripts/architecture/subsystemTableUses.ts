import { dirname, join, normalize } from "node:path";
import * as ts from "typescript";

// Schema modules declare tables or gather them into table lists; they are the
// SQLite Runtime's catalog, not users of another subsystem's data.
const schemaDirectoryPattern = /\/sqlite\/schema\//;
// Raw SQL names a table after these keywords; the SDK writes them upper case,
// so prose in strings and comments does not match.
const rawSqlWritePattern =
  /\b(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-z][a-z0-9_]*)\b/g;
const rawSqlReadPattern = /\b(?:FROM|JOIN)\s+["`]?([a-z][a-z0-9_]*)\b/g;
const resolvableSuffixes = [".ts", ".tsx", "/index.ts", "/index.tsx"];
// Drizzle calls that only read the table passed to them, or write it.
const readCalls = new Set([
  "crossJoin",
  "from",
  "fullJoin",
  "innerJoin",
  "leftJoin",
  "rightJoin",
]);
const writeCalls = new Set(["delete", "insert", "update"]);

export type TableAccess = "read" | "write";

/** A production file reaching a declared table outside a schema module. */
export interface SubsystemTableUse {
  access: TableAccess;
  from: string;
  table: string;
}

function strongerAccess(
  a: TableAccess | undefined,
  b: TableAccess,
): TableAccess {
  return a === "write" || b === "write" ? "write" : "read";
}

/**
 * How code uses a table reference: a column read, a `from` or join, or a
 * `typeof` reads it; `insert`, `update`, and `delete` write it. Anything else,
 * such as passing the table to a helper or listing it for a loop, counts as a
 * write, so an indirect write cannot pass as a read.
 */
export function referenceAccess(node: ts.Node): TableAccess {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return "read";
  }
  if (ts.isTypeQueryNode(parent)) return "read";
  if (
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === node) &&
    ts.isPropertyAccessExpression(parent.expression)
  ) {
    const call = parent.expression.name.text;
    if (readCalls.has(call)) return "read";
    if (writeCalls.has(call)) return "write";
  }
  return "write";
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

/** The tables raw SQL in the file's strings and templates reads or writes. */
export function rawSqlTableAccess(
  source: ts.SourceFile,
): Map<string, TableAccess> {
  const access = new Map<string, TableAccess>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const [pattern, kind] of [
        [rawSqlReadPattern, "read"],
        [rawSqlWritePattern, "write"],
      ] as const) {
        for (const match of node.text.matchAll(pattern)) {
          const name = match[1];
          if (name !== undefined) {
            access.set(name, strongerAccess(access.get(name), kind));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return access;
}

/** The exported object literals in a schema module whose values are tables. */
function schemaObjectTableKeys(
  source: ts.SourceFile,
  tables: ReadonlySet<string>,
): { key: string; object: string; table: string }[] {
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
      const literal = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        literal === undefined ||
        !ts.isObjectLiteralExpression(literal)
      ) {
        return [];
      }
      const object = declaration.name.text;
      return literal.properties.flatMap((property) => {
        const value = ts.isShorthandPropertyAssignment(property)
          ? property.name
          : ts.isPropertyAssignment(property)
            ? property.initializer
            : undefined;
        return value !== undefined &&
          ts.isIdentifier(value) &&
          tables.has(value.text) &&
          property.name !== undefined &&
          ts.isIdentifier(property.name)
          ? [{ key: property.name.text, object, table: value.text }]
          : [];
      });
    });
  });
}

/** Identifiers a file binds to schema modules and to schema objects. */
export interface SchemaRoots {
  /** `import * as schema from "./schema"`, by local name. */
  readonly namespaces: ReadonlySet<string>;
  /** `import { clientSQLiteSchema } from "./schema"`, by local name. */
  readonly objects: ReadonlySet<string>;
  /** Every exported schema object's name, to follow `schema.clientSQLiteSchema`. */
  readonly schemaObjectNames: ReadonlySet<string>;
}

function accessedKey(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function isSchemaRoot(node: ts.Expression, roots: SchemaRoots): boolean {
  if (ts.isIdentifier(node)) {
    return roots.namespaces.has(node.text) || roots.objects.has(node.text);
  }
  const key = accessedKey(node);
  if (key === undefined) return false;
  // Drizzle's relational API: `db.query.documents`, `db.query["documents"]`.
  if (key === "query") return true;
  const target = (
    node as ts.PropertyAccessExpression | ts.ElementAccessExpression
  ).expression;
  return (
    ts.isIdentifier(target) &&
    roots.namespaces.has(target.text) &&
    roots.schemaObjectNames.has(key)
  );
}

function isRelationalQuery(node: ts.Expression): boolean {
  return accessedKey(node) === "query";
}

function schemaKeysAccessedAt(
  node: ts.Node,
  roots: SchemaRoots,
): [string, TableAccess][] {
  const key = accessedKey(node);
  if (key !== undefined) {
    const target = (
      node as ts.PropertyAccessExpression | ts.ElementAccessExpression
    ).expression;
    if (!isSchemaRoot(target, roots)) return [];
    // Drizzle's relational API only reads.
    return [[key, isRelationalQuery(target) ? "read" : referenceAccess(node)]];
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isObjectBindingPattern(node.name) &&
    node.initializer !== undefined &&
    isSchemaRoot(node.initializer, roots)
  ) {
    // A destructured table is then used under another name; count it as a write.
    const access = isRelationalQuery(node.initializer) ? "read" : "write";
    return node.name.elements.flatMap((element) => {
      const name = element.propertyName ?? element.name;
      return ts.isIdentifier(name) ? [[name.text, access] as const] : [];
    });
  }
  return [];
}

/**
 * Keys a file reaches through a schema root: a schema module namespace, an
 * imported schema object, a schema object reached through a namespace, or
 * Drizzle's `db.query`, with how it uses each. Property access, a literal
 * index, and destructuring all count. Passing a whole root along, as SQLite
 * Runtime does to build the Drizzle database, names nothing.
 */
export function schemaKeyAccessInSource(
  source: ts.SourceFile,
  roots: SchemaRoots,
): Map<string, TableAccess> {
  const access = new Map<string, TableAccess>();
  const visit = (node: ts.Node): void => {
    for (const [key, kind] of schemaKeysAccessedAt(node, roots)) {
      access.set(key, strongerAccess(access.get(key), kind));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return access;
}

interface SchemaCatalog {
  readonly isSchemaModule: (filePath: string) => boolean;
  readonly schemaObjectNames: ReadonlySet<string>;
  readonly tables: ReadonlySet<string>;
  readonly tablesBySchemaKey: ReadonlyMap<string, string>;
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
  const isSchemaModule = (filePath: string) =>
    declarationsByFile.has(filePath) || schemaDirectoryPattern.test(filePath);
  const declarations = [...declarationsByFile.values()].flat();
  const tables = new Set(declarations.map(({ name }) => name));
  const schemaObjectKeys = [...sources].flatMap(([filePath, source]) =>
    isSchemaModule(filePath) ? schemaObjectTableKeys(source, tables) : [],
  );
  return {
    isSchemaModule,
    schemaObjectNames: new Set(schemaObjectKeys.map(({ object }) => object)),
    tables,
    tablesBySchemaKey: new Map(
      schemaObjectKeys.map(({ key, table }) => [key, table]),
    ),
    tablesBySqlName: new Map(
      declarations.flatMap(({ name, sqlName }) =>
        sqlName === undefined ? [] : [[sqlName, name] as const],
      ),
    ),
  };
}

function targetsSchemaModule(
  statement: ts.Statement,
  from: string,
  catalog: SchemaCatalog,
  knownFiles: ReadonlySet<string>,
): statement is ts.ImportDeclaration | ts.ExportDeclaration {
  if (
    !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
    statement.moduleSpecifier === undefined ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return false;
  }
  const to = resolveRelativeImport(
    from,
    statement.moduleSpecifier.text,
    knownFiles,
  );
  return to !== undefined && catalog.isSchemaModule(to);
}

function readNamedSchemaImports(
  bindings: ts.NamedImports | ts.NamedExports,
  catalog: SchemaCatalog,
): { objects: string[]; tables: { local: string; table: string }[] } {
  const named = bindings.elements.map((element) => ({
    local: element.name.text,
    name: (element.propertyName ?? element.name).text,
  }));
  return {
    objects: named
      .filter(({ name }) => catalog.schemaObjectNames.has(name))
      .map(({ local }) => local),
    tables: named
      .filter(({ name }) => catalog.tables.has(name))
      .map(({ local, name }) => ({ local, table: name })),
  };
}

interface SchemaImports {
  /** Imported tables by local name; their references decide the access. */
  readonly bindings: ReadonlyMap<string, string>;
  /** Tables re-exported by name or by `export *`: written onward. */
  readonly reexported: readonly string[];
  readonly roots: SchemaRoots;
}

/**
 * Reads one file's schema imports: the tables it imports by local name, the
 * tables it re-exports (every one, for a wholesale `export *`), and the
 * namespaces and schema objects it binds for `schemaKeyAccessInSource`.
 */
function readSchemaImports(
  from: string,
  source: ts.SourceFile,
  catalog: SchemaCatalog,
  knownFiles: ReadonlySet<string>,
): SchemaImports {
  const bindings = new Map<string, string>();
  const namespaces = new Set<string>();
  const objects = new Set<string>();
  const reexported: string[] = [];
  for (const statement of source.statements) {
    if (!targetsSchemaModule(statement, from, catalog, knownFiles)) continue;
    const named = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause;
    if (named !== undefined && ts.isNamespaceImport(named)) {
      namespaces.add(named.name.text);
      continue;
    }
    if (named === undefined || ts.isNamespaceExport(named)) {
      reexported.push(...catalog.tables);
      continue;
    }
    const read = readNamedSchemaImports(named, catalog);
    if (ts.isExportDeclaration(statement)) {
      reexported.push(...read.tables.map(({ table }) => table));
      continue;
    }
    for (const { local, table } of read.tables) bindings.set(local, table);
    for (const object of read.objects) objects.add(object);
  }
  return {
    bindings,
    reexported,
    roots: {
      namespaces,
      objects,
      schemaObjectNames: catalog.schemaObjectNames,
    },
  };
}

/** How the file uses each imported table binding; an unused import reads. */
function importedTableAccess(
  source: ts.SourceFile,
  bindings: ReadonlyMap<string, string>,
): Map<string, TableAccess> {
  const access = new Map<string, TableAccess>(
    [...bindings.values()].map((table) => [table, "read"]),
  );
  const visit = (node: ts.Node): void => {
    const table = ts.isIdentifier(node) ? bindings.get(node.text) : undefined;
    if (
      table !== undefined &&
      !ts.isImportSpecifier(node.parent) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      access.set(
        table,
        strongerAccess(access.get(table), referenceAccess(node)),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return access;
}

/** Table uses in parsed production sources, outside schema modules. */
export function findTableUsesInSources(
  sources: ReadonlyMap<string, ts.SourceFile>,
): { declaredTables: string[]; uses: SubsystemTableUse[] } {
  const catalog = readSchemaCatalog(sources);
  const knownFiles = new Set(sources.keys());
  const uses: SubsystemTableUse[] = [];
  for (const [from, source] of sources) {
    if (catalog.isSchemaModule(from)) continue;
    const imports = readSchemaImports(from, source, catalog, knownFiles);
    const access = importedTableAccess(source, imports.bindings);
    const add = (table: string | undefined, kind: TableAccess) => {
      if (table !== undefined) {
        access.set(table, strongerAccess(access.get(table), kind));
      }
    };
    for (const table of imports.reexported) add(table, "write");
    for (const [key, kind] of schemaKeyAccessInSource(source, imports.roots)) {
      add(
        catalog.tablesBySchemaKey.get(key) ??
          (catalog.tables.has(key) ? key : undefined),
        kind,
      );
    }
    for (const [sqlName, kind] of rawSqlTableAccess(source)) {
      add(catalog.tablesBySqlName.get(sqlName), kind);
    }
    for (const [table, kind] of access)
      uses.push({ access: kind, from, table });
  }
  return { declaredTables: [...catalog.tables], uses };
}
