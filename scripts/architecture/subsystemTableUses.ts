import * as ts from "typescript";
import {
  elementKey,
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
    ts.isBindingElement(parent) ||
    ts.isParameter(parent) ||
    ((ts.isVariableDeclaration(parent) ||
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
 * A declaration's initializer only names what the declared binding stands
 * for; the binding's references are the uses.
 */
function isBoundInitializer(node: ts.Node): boolean {
  return (
    ts.isVariableDeclaration(node.parent) && node.parent.initializer === node
  );
}

/** Drizzle's relational API, `db.query.documents`, only reads. */
function relationalKey(node: ts.Node): string | undefined {
  if (
    !(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
  ) {
    return undefined;
  }
  const owner = node.expression;
  const ownerKey = ts.isPropertyAccessExpression(owner)
    ? owner.name.text
    : ts.isElementAccessExpression(owner)
      ? elementKey(owner.argumentExpression)
      : undefined;
  if (ownerKey !== "query") return undefined;
  return ts.isPropertyAccessExpression(node)
    ? node.name.text
    : elementKey(node.argumentExpression);
}

function accessUses(
  catalog: TableCatalog,
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): [string, TableAccess][] {
  const relational = relationalKey(node);
  const relationalTable =
    relational === undefined
      ? undefined
      : catalog.tablesByQueryKey.get(relational);
  if (relationalTable !== undefined) return [[relationalTable, "read"]];
  if (
    ts.isElementAccessExpression(node) &&
    elementKey(node.argumentExpression) === undefined
  ) {
    // `schema[name]`: any table the indexed value holds, possibly written.
    return catalog.resolver
      .typeTables(node.expression)
      .map((table) => [table, "write"] as [string, TableAccess]);
  }
  return isBoundInitializer(node) ? [] : valueUses(catalog, node);
}

/** Drizzle's `schema` option builds the database `db.query` reads through. */
function isDrizzleSchemaOption(node: ts.Expression): boolean {
  const option = node.parent;
  const call = option.parent?.parent;
  return (
    ts.isPropertyAssignment(option) &&
    literalKey(option.name) === "schema" &&
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "drizzle"
  );
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
    isBoundInitializer(node) ||
    ts.isTypeQueryNode(parent) ||
    ts.isExportAssignment(parent) ||
    isDrizzleSchemaOption(node)
  );
}

/** A table, or a schema value whose tables all escape and may be written. */
function valueUses(
  catalog: TableCatalog,
  node: ts.Expression,
): [string, TableAccess][] {
  const table = catalog.resolver.expression(node);
  if (table !== undefined) return [[table, referenceAccess(node)]];
  return escapes(node)
    ? catalog.resolver
        .typeTables(node)
        .map((held) => [held, "write"] as [string, TableAccess])
    : [];
}

function nodeUses(
  catalog: TableCatalog,
  node: ts.Node,
): [string, TableAccess][] {
  if (
    ts.isIdentifier(node) &&
    !isDeclaredName(node) &&
    !isBoundInitializer(node)
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
  // `const { documents: { id } } = schema` reads the table it destructures.
  if (
    ts.isBindingElement(node) &&
    ts.isObjectBindingPattern(node.name) &&
    !node.dotDotDotToken
  ) {
    const key = literalKey(node.propertyName ?? node.name);
    const table =
      key === undefined
        ? undefined
        : catalog.resolver.property(node.parent, key);
    return table === undefined ? [] : [[table, "read"]];
  }
  return [];
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
