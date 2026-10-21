import * as ts from "typescript";
import {
  elementKey,
  isDrizzleSchemaOption,
  literalKey,
  readTableCatalog,
  type TableCatalog,
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

/** Names that declare, rather than refer to, a binding or property. */
function isDeclaredName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node)
  );
}

/**
 * A declaration of one name, a variable or a parameter's default, only says
 * what the name stands for; the name's references are the uses.
 */
function isAliasInitializer(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) &&
    parent.initializer === node &&
    ts.isIdentifier(parent.name)
  );
}

/** The value a declaration destructures, as in `const { id } = documents`. */
function isDestructuredSource(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) &&
    parent.initializer === node &&
    !ts.isIdentifier(parent.name)
  );
}

/**
 * Drizzle's relational API only reads: one table by key, or, when the key is
 * computed or the query object is passed along, every table its type serves,
 * or every table at all when its type is unknown.
 */
function relationalUses(
  catalog: TableCatalog,
  owner: ts.Expression | ts.BindingPattern,
  key: string | undefined,
): [string, TableAccess][] {
  const served = catalog.resolver
    .propertyNames(owner)
    .filter((name) => catalog.tablesByQueryKey.has(name));
  const keys =
    key !== undefined
      ? [key]
      : served.length > 0
        ? served
        : [...catalog.tablesByQueryKey.keys()];
  return [
    ...new Set(keys.map((name) => catalog.tablesByQueryKey.get(name))),
  ].flatMap((table) =>
    table === undefined ? [] : [[table, "read"] as [string, TableAccess]],
  );
}

function accessUses(
  catalog: TableCatalog,
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): [string, TableAccess][] {
  if (catalog.resolver.isRelational(node.expression)) {
    return relationalUses(
      catalog,
      node.expression,
      ts.isPropertyAccessExpression(node)
        ? node.name.text
        : elementKey(node.argumentExpression),
    );
  }
  if (
    ts.isElementAccessExpression(node) &&
    elementKey(node.argumentExpression) === undefined
  ) {
    // `schema[name]`: any table the indexed value holds, possibly written.
    return catalog.resolver
      .typeTables(node.expression)
      .map((table) => [table, "write"] as [string, TableAccess]);
  }
  return isAliasInitializer(node) ? [] : valueUses(catalog, node);
}

/**
 * Whether a value leaves where its tables can be told apart: passed, returned,
 * listed, or spread, rather than read by key, aliased, re-exported, or named
 * in a type.
 */
function escapes(node: ts.Expression): boolean {
  const parent = node.parent;
  return !(
    ((ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)) &&
      parent.expression === node) ||
    (ts.isQualifiedName(parent) && parent.left === node) ||
    ts.isPartOfTypeNode(node) ||
    isAliasInitializer(node) ||
    ts.isTypeQueryNode(parent) ||
    ts.isExportAssignment(parent) ||
    isDrizzleSchemaOption(node)
  );
}

/**
 * A table, or a schema value whose tables all escape and may be written. A
 * destructured table has its columns read; a destructured schema value's
 * bindings are checked where they are used.
 */
function valueUses(
  catalog: TableCatalog,
  node: ts.Expression,
): [string, TableAccess][] {
  const table = catalog.resolver.expression(node);
  if (isDestructuredSource(node)) {
    return table === undefined ? [] : [[table, "read"]];
  }
  if (table !== undefined) return [[table, referenceAccess(node)]];
  if (!escapes(node)) return [];
  // A query object passed along may read any table it serves.
  if (
    catalog.resolver.isRelational(node) &&
    catalog.resolver
      .propertyNames(node)
      .some((key) => catalog.tablesByQueryKey.has(key))
  ) {
    return relationalUses(catalog, node, undefined);
  }
  return catalog.resolver
    .typeTables(node)
    .map((held) => [held, "write"] as [string, TableAccess]);
}

/**
 * A key destructured from `db.query` reads its table, and one destructured by a
 * computed key may be any table of its source. A nested pattern reads the
 * columns of the table it destructures; a bound name is checked where used.
 */
function bindingUses(
  catalog: TableCatalog,
  node: ts.BindingElement,
): [string, TableAccess][] {
  const pattern = node.parent;
  if (node.dotDotDotToken || !ts.isObjectBindingPattern(pattern)) return [];
  const key = literalKey(node.propertyName ?? node.name);
  if (catalog.resolver.isRelationalPattern(pattern)) {
    return relationalUses(catalog, pattern, key);
  }
  if (key === undefined) {
    return catalog.resolver
      .typeTables(pattern)
      .map((held) => [held, "write"] as [string, TableAccess]);
  }
  const table = ts.isObjectBindingPattern(node.name)
    ? catalog.resolver.property(pattern, key)
    : undefined;
  return table === undefined ? [] : [[table, "read"]];
}

function nodeUses(
  catalog: TableCatalog,
  node: ts.Node,
): [string, TableAccess][] {
  if (
    ts.isIdentifier(node) &&
    !isDeclaredName(node) &&
    !isAliasInitializer(node)
  ) {
    return valueUses(catalog, node);
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    return accessUses(catalog, node);
  }
  // `typeof schema.documents.$inferSelect` reads the table it names.
  if (ts.isQualifiedName(node)) {
    const table = catalog.resolver.qualifiedName(node);
    return table === undefined ? [] : [[table, "read"]];
  }
  return ts.isBindingElement(node) ? bindingUses(catalog, node) : [];
}

/**
 * Table uses in production files outside schema modules. The type checker
 * resolves each reference to the table it stands for, through imports,
 * re-exports, aliases, destructuring, and dynamic imports, so a re-export is
 * not itself a use: each table is checked where it is read or written.
 */
export function findTableUsesInProgram(
  program: ts.Program,
  files: readonly string[],
): { declaredTables: string[]; uses: SubsystemTableUse[] } {
  const catalog = readTableCatalog(program, files);
  const uses: SubsystemTableUse[] = [];
  for (const from of files) {
    const source = program.getSourceFile(from);
    if (source === undefined || catalog.isSchemaModule(from)) continue;
    const access = new Map<string, TableAccess>();
    const add = (table: string, kind: TableAccess) =>
      access.set(table, strongerAccess(access.get(table), kind));
    const visit = (node: ts.Node): void => {
      for (const [table, kind] of nodeUses(catalog, node)) add(table, kind);
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const [sqlName, kind] of rawSqlTableAccess(source)) {
      const table = catalog.tablesBySqlName.get(sqlName);
      if (table !== undefined) add(table, kind);
    }
    for (const [table, kind] of access)
      uses.push({ access: kind, from, table });
  }
  return { declaredTables: [...catalog.declaredTables], uses };
}
