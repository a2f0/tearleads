import * as ts from "typescript";
import {
  exportedValue,
  type ModuleExports,
  readSchemaCatalog,
  resolveRelativeImport,
  type SchemaCatalog,
  type SchemaValue,
  valueTables,
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

/**
 * A name or expression that reaches a table: a schema value, Drizzle's
 * `db.query`, or one of its relational members, which only read.
 */
type Reach =
  | SchemaValue
  | { readonly kind: "query" }
  | { readonly kind: "relational"; readonly table: string };

interface FileContext {
  readonly bindings: Map<string, Reach>;
  readonly catalog: SchemaCatalog;
  readonly from: string;
  readonly knownFiles: ReadonlySet<string>;
  readonly uses: Map<string, TableAccess>;
}

function use(context: FileContext, table: string, access: TableAccess): void {
  context.uses.set(table, strongerAccess(context.uses.get(table), access));
}

function useAll(context: FileContext, reach: Reach | undefined): void {
  if (reach === undefined || reach.kind === "query") return;
  if (reach.kind === "relational") {
    use(context, reach.table, "read");
    return;
  }
  for (const table of valueTables(reach)) use(context, table, "write");
}

function hasSchemaValues(exports: ModuleExports): boolean {
  return (
    exports.tables.size > 0 ||
    exports.objects.size > 0 ||
    exports.namespaces.size > 0
  );
}

/** The schema values a module exports, if it exports any. */
function schemaModuleExports(
  context: FileContext,
  specifier: ts.Expression | undefined,
): ModuleExports | undefined {
  if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
    return undefined;
  }
  const to = resolveRelativeImport(
    context.from,
    specifier.text,
    context.knownFiles,
  );
  const exports =
    to === undefined ? undefined : context.catalog.moduleExports(to);
  return exports !== undefined && hasSchemaValues(exports)
    ? exports
    : undefined;
}

function dynamicImportExports(
  context: FileContext,
  node: ts.Node,
): ModuleExports | undefined {
  return ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
    ? schemaModuleExports(context, node.arguments[0])
    : undefined;
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

function memberOf(
  context: FileContext,
  owner: Reach | undefined,
  key: string,
): Reach | undefined {
  if (owner?.kind === "namespace") return exportedValue(owner.exports, key);
  if (owner?.kind === "object") {
    const table = owner.keys.get(key);
    return table === undefined ? undefined : { kind: "table", table };
  }
  if (owner?.kind === "query") {
    const table = context.catalog.tablesByQueryKey.get(key);
    return table === undefined ? undefined : { kind: "relational", table };
  }
  return undefined;
}

/** What an expression reaches: a bound name, an awaited import, or a member. */
function reachOf(
  context: FileContext,
  expression: ts.Expression,
): Reach | undefined {
  if (ts.isParenthesizedExpression(expression)) {
    return reachOf(context, expression.expression);
  }
  if (ts.isIdentifier(expression)) return context.bindings.get(expression.text);
  if (ts.isAwaitExpression(expression)) {
    const exports = dynamicImportExports(context, expression.expression);
    return exports === undefined ? undefined : { kind: "namespace", exports };
  }
  const key = accessedKey(expression);
  if (key === undefined) return undefined;
  // Drizzle's relational API: `db.query.documents`, `db.query["documents"]`.
  if (key === "query") return { kind: "query" };
  const owner = (
    expression as ts.PropertyAccessExpression | ts.ElementAccessExpression
  ).expression;
  return memberOf(context, reachOf(context, owner), key);
}

function bindingKey(element: ts.BindingElement): string | undefined {
  const name = element.propertyName ?? element.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(name.expression)
    ? name.expression.text
    : undefined;
}

/** Binds the names a destructuring pattern takes from what it reaches. */
function destructure(
  context: FileContext,
  owner: Reach,
  pattern: ts.ObjectBindingPattern,
): void {
  for (const element of pattern.elements) {
    const key = element.dotDotDotToken ? undefined : bindingKey(element);
    if (key === undefined) {
      useAll(context, owner);
      continue;
    }
    const member = memberOf(context, owner, key);
    if (member === undefined) continue;
    if (ts.isIdentifier(element.name)) {
      context.bindings.set(element.name.text, member);
    } else if (ts.isObjectBindingPattern(element.name)) {
      if (member.kind === "table") use(context, member.table, "read");
      else destructure(context, member, element.name);
    } else {
      useAll(context, member);
    }
  }
}

/**
 * Binds a file's static imports of schema values. Re-exports are not uses:
 * the catalog resolves imports through them, so each table is checked where
 * it is read or written.
 */
function readStaticImports(context: FileContext, source: ts.SourceFile): void {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const exports = schemaModuleExports(context, statement.moduleSpecifier);
    const named = statement.importClause?.namedBindings;
    if (exports === undefined || named === undefined) continue;
    if (ts.isNamespaceImport(named)) {
      context.bindings.set(named.name.text, { kind: "namespace", exports });
      continue;
    }
    for (const element of named.elements) {
      const value = exportedValue(
        exports,
        (element.propertyName ?? element.name).text,
      );
      if (value !== undefined) context.bindings.set(element.name.text, value);
    }
  }
}

/** Follows declarations that bind or destructure what an expression reaches. */
function readDeclarations(context: FileContext, source: ts.SourceFile): void {
  for (let pass = 0; pass < 4; pass += 1) {
    const before = context.bindings.size;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const reach = reachOf(context, node.initializer);
        if (reach !== undefined && ts.isIdentifier(node.name)) {
          context.bindings.set(node.name.text, reach);
        } else if (
          reach !== undefined &&
          ts.isObjectBindingPattern(node.name)
        ) {
          destructure(context, reach, node.name);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (context.bindings.size === before) return;
  }
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) &&
      (parent.name === node || parent.propertyName === node)) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
  );
}

/** A declaration initializer only binds; its names' references are the uses. */
function isBoundInitializer(node: ts.Node): boolean {
  return (
    ts.isVariableDeclaration(node.parent) && node.parent.initializer === node
  );
}

function recordReference(context: FileContext, node: ts.Identifier): void {
  if (isDeclarationName(node)) return;
  const reach = context.bindings.get(node.text);
  if (reach?.kind === "table") use(context, reach.table, referenceAccess(node));
  if (reach?.kind === "relational") use(context, reach.table, "read");
}

function recordAccess(
  context: FileContext,
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): void {
  if (accessedKey(node) === undefined) {
    // `schema[name]`: any table of the schema value, possibly written.
    const owner = reachOf(context, node.expression);
    if (owner?.kind === "namespace" || owner?.kind === "object") {
      useAll(context, owner);
    }
    return;
  }
  if (isBoundInitializer(node)) return;
  const reach = reachOf(context, node);
  if (reach?.kind === "table") use(context, reach.table, referenceAccess(node));
  if (reach?.kind === "relational") use(context, reach.table, "read");
}

/**
 * A dynamic import is followed when awaited into a declaration or a member
 * access; any other use writes every table the module exports.
 */
function recordDynamicImport(context: FileContext, node: ts.Node): void {
  const exports = dynamicImportExports(context, node);
  if (exports === undefined) return;
  const awaited = ts.isAwaitExpression(node.parent) ? node.parent : undefined;
  const consumer = awaited?.parent;
  const followed =
    consumer !== undefined &&
    (isBoundInitializer(awaited as ts.Node) ||
      (ts.isParenthesizedExpression(consumer) &&
        accessedKey(consumer.parent) !== undefined));
  if (!followed) useAll(context, { kind: "namespace", exports });
}

function recordUses(context: FileContext, source: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) recordReference(context, node);
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      recordAccess(context, node);
    }
    recordDynamicImport(context, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
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
    const context: FileContext = {
      bindings: new Map(),
      catalog,
      from,
      knownFiles,
      uses: new Map(),
    };
    readStaticImports(context, source);
    readDeclarations(context, source);
    recordUses(context, source);
    for (const [sqlName, access] of rawSqlTableAccess(source)) {
      const table = catalog.tablesBySqlName.get(sqlName);
      if (table !== undefined) use(context, table, access);
    }
    for (const [table, access] of context.uses) {
      uses.push({ access, from, table });
    }
  }
  return { declaredTables: [...catalog.declaredTables], uses };
}
