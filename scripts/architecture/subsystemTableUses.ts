import * as ts from "typescript";
import {
  readSchemaCatalog,
  resolveRelativeImport,
  type SchemaCatalog,
} from "./subsystemTableCatalog";

// Raw SQL names a table after these keywords; the SDK writes them upper case,
// so prose in strings and comments does not match.
const rawSqlWritePattern =
  /\b(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-z][a-z0-9_]*)\b/g;
const rawSqlReadPattern = /\b(?:FROM|JOIN)\s+["`]?([a-z][a-z0-9_]*)\b/g;
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
  // `typeof table` and `typeof table.$inferSelect` are types, not data access.
  if (
    ts.isTypeQueryNode(parent) ||
    (ts.isQualifiedName(parent) && parent.left === node)
  ) {
    return "read";
  }
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

/** The schema module an import or export statement names, if any. */
function schemaModuleTarget(
  statement: ts.Statement,
  from: string,
  catalog: SchemaCatalog,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  if (
    !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
    statement.moduleSpecifier === undefined ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return undefined;
  }
  const to = resolveRelativeImport(
    from,
    statement.moduleSpecifier.text,
    knownFiles,
  );
  return to !== undefined && catalog.isSchemaModule(to) ? to : undefined;
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
  readonly bindings: Map<string, string>;
  /** Tables re-exported, or reached by an import nothing tracks: written. */
  readonly reexported: string[];
  readonly roots: {
    readonly namespaces: Set<string>;
    readonly objects: Set<string>;
    readonly schemaObjectNames: ReadonlySet<string>;
  };
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
    const to = schemaModuleTarget(statement, from, catalog, knownFiles);
    if (
      to === undefined ||
      !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
    ) {
      continue;
    }
    const named = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause;
    if (named !== undefined && ts.isNamespaceImport(named)) {
      namespaces.add(named.name.text);
      continue;
    }
    if (named === undefined || ts.isNamespaceExport(named)) {
      reexported.push(...catalog.exportedTables(to));
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

/**
 * Adds a file's dynamic schema imports. A bound namespace or destructured
 * table or schema object is tracked like a static import; any other dynamic
 * import writes every table the module exports.
 */
function readDynamicSchemaImports(
  from: string,
  source: ts.SourceFile,
  catalog: SchemaCatalog,
  knownFiles: ReadonlySet<string>,
  imports: SchemaImports,
): void {
  const visit = (node: ts.Node): void => {
    const [specifier] = ts.isCallExpression(node) ? node.arguments : [];
    const to =
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      specifier !== undefined &&
      ts.isStringLiteralLike(specifier)
        ? resolveRelativeImport(from, specifier.text, knownFiles)
        : undefined;
    if (to !== undefined && catalog.isSchemaModule(to)) {
      readDynamicImportBinding(node, to, catalog, imports);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function readDynamicImportBinding(
  call: ts.Node,
  to: string,
  catalog: SchemaCatalog,
  imports: SchemaImports,
): void {
  const value = ts.isAwaitExpression(call.parent) ? call.parent : call;
  const declaration = value.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== value
  ) {
    imports.reexported.push(...catalog.exportedTables(to));
    return;
  }
  if (ts.isIdentifier(declaration.name)) {
    imports.roots.namespaces.add(declaration.name.text);
    return;
  }
  for (const element of ts.isObjectBindingPattern(declaration.name)
    ? declaration.name.elements
    : []) {
    const key = element.propertyName ?? element.name;
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) {
      imports.reexported.push(...catalog.exportedTables(to));
    } else if (ts.isIdentifier(key) && catalog.tables.has(key.text)) {
      imports.bindings.set(element.name.text, key.text);
    } else if (
      ts.isIdentifier(key) &&
      catalog.schemaObjectNames.has(key.text)
    ) {
      imports.roots.objects.add(element.name.text);
    }
  }
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
    // Skip where the binding is declared or named as a property, not used.
    if (
      table !== undefined &&
      !ts.isImportSpecifier(node.parent) &&
      !(
        ts.isBindingElement(node.parent) &&
        (node.parent.name === node || node.parent.propertyName === node)
      ) &&
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
    readDynamicSchemaImports(from, source, catalog, knownFiles, imports);
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
