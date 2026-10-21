import { dirname, join, normalize } from "node:path";
import * as ts from "typescript";

// Schema modules declare tables or gather them into table lists; they are the
// SQLite Runtime's catalog, not users of another subsystem's data.
const schemaDirectoryPattern = /\/sqlite\/schema\//;
const resolvableSuffixes = [".ts", ".tsx", "/index.ts", "/index.tsx"];

export function resolveRelativeImport(
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

/** What a schema module exports that reaches a table, by exported name. */
export interface ModuleExports {
  readonly namespaces: ReadonlyMap<string, ModuleExports>;
  readonly objects: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly tables: ReadonlyMap<string, string>;
}

/** A name bound to a table, a schema object's keys, or a module namespace. */
export type SchemaValue =
  | { readonly kind: "namespace"; readonly exports: ModuleExports }
  | { readonly kind: "object"; readonly keys: ReadonlyMap<string, string> }
  | { readonly kind: "table"; readonly table: string };

const noExports: ModuleExports = {
  namespaces: new Map(),
  objects: new Map(),
  tables: new Map(),
};

export function exportedValue(
  exports: ModuleExports,
  name: string,
): SchemaValue | undefined {
  const table = exports.tables.get(name);
  if (table !== undefined) return { kind: "table", table };
  const keys = exports.objects.get(name);
  if (keys !== undefined) return { kind: "object", keys };
  const namespace = exports.namespaces.get(name);
  return namespace === undefined
    ? undefined
    : { kind: "namespace", exports: namespace };
}

/** Every table a schema value can reach. */
export function valueTables(
  value: SchemaValue,
  seen: Set<ModuleExports> = new Set(),
): string[] {
  if (value.kind === "table") return [value.table];
  if (value.kind === "object") return [...value.keys.values()];
  if (seen.has(value.exports)) return [];
  seen.add(value.exports);
  const { namespaces, objects, tables } = value.exports;
  return [
    ...new Set([
      ...tables.values(),
      ...[...objects.values()].flatMap((keys) => [...keys.values()]),
      ...[...namespaces.values()].flatMap((exports) =>
        valueTables({ kind: "namespace", exports }, seen),
      ),
    ]),
  ];
}

function propertyKey(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(name.expression)
    ? name.expression.text
    : undefined;
}

/** The value an expression in a schema module names, through its locals. */
function localValue(
  expression: ts.Expression,
  locals: ReadonlyMap<string, SchemaValue>,
): SchemaValue | undefined {
  if (ts.isIdentifier(expression)) return locals.get(expression.text);
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const owner = localValue(expression.expression, locals);
  return owner?.kind === "namespace"
    ? exportedValue(owner.exports, expression.name.text)
    : undefined;
}

/** The tables an object literal in a schema module holds, by key. */
function objectLiteralKeys(
  literal: ts.ObjectLiteralExpression,
  locals: ReadonlyMap<string, SchemaValue>,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = localValue(property.expression, locals);
      if (spread?.kind === "object") {
        for (const [key, table] of spread.keys) keys.set(key, table);
      }
      continue;
    }
    const key = propertyKey(property.name);
    const value = ts.isShorthandPropertyAssignment(property)
      ? locals.get(property.name.text)
      : ts.isPropertyAssignment(property)
        ? localValue(property.initializer, locals)
        : undefined;
    if (key !== undefined && value?.kind === "table") {
      keys.set(key, value.table);
    }
  }
  return keys;
}

function readImportLocals(
  statement: ts.ImportDeclaration,
  resolve: (specifier: string) => ModuleExports | undefined,
  locals: Map<string, SchemaValue>,
): void {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
  const exports = resolve(statement.moduleSpecifier.text);
  const named = statement.importClause?.namedBindings;
  if (exports === undefined || named === undefined) return;
  if (ts.isNamespaceImport(named)) {
    locals.set(named.name.text, { kind: "namespace", exports });
    return;
  }
  for (const element of named.elements) {
    const value = exportedValue(
      exports,
      (element.propertyName ?? element.name).text,
    );
    if (value !== undefined) locals.set(element.name.text, value);
  }
}

function readObjectLocals(
  statement: ts.VariableStatement,
  locals: Map<string, SchemaValue>,
): void {
  for (const declaration of statement.declarationList.declarations) {
    const literal = declaration.initializer;
    if (
      !ts.isIdentifier(declaration.name) ||
      literal === undefined ||
      !ts.isObjectLiteralExpression(literal)
    ) {
      continue;
    }
    const keys = objectLiteralKeys(literal, locals);
    if (keys.size > 0) {
      locals.set(declaration.name.text, { kind: "object", keys });
    }
  }
}

/** A schema module's names that reach tables: its tables, imports, and objects. */
function readLocals(
  source: ts.SourceFile,
  resolve: (specifier: string) => ModuleExports | undefined,
): Map<string, SchemaValue> {
  const locals = new Map<string, SchemaValue>(
    declaredTables(source).map(({ name }) => [
      name,
      { kind: "table", table: name },
    ]),
  );
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      readImportLocals(statement, resolve, locals);
    }
  }
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) readObjectLocals(statement, locals);
  }
  return locals;
}

function addExport(
  exports: {
    namespaces: Map<string, ModuleExports>;
    objects: Map<string, ReadonlyMap<string, string>>;
    tables: Map<string, string>;
  },
  name: string,
  value: SchemaValue | undefined,
): void {
  if (value?.kind === "table") exports.tables.set(name, value.table);
  if (value?.kind === "object") exports.objects.set(name, value.keys);
  if (value?.kind === "namespace") exports.namespaces.set(name, value.exports);
}

function readModuleExports(
  source: ts.SourceFile,
  resolve: (specifier: string) => ModuleExports | undefined,
): ModuleExports {
  const locals = readLocals(source, resolve);
  const exports = {
    namespaces: new Map<string, ModuleExports>(),
    objects: new Map<string, ReadonlyMap<string, string>>(),
    tables: new Map<string, string>(),
  };
  for (const statement of source.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          addExport(exports, name, locals.get(name));
        }
      }
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      readExportDeclaration(statement, locals, resolve, exports);
    }
  }
  return exports;
}

function readExportDeclaration(
  statement: ts.ExportDeclaration,
  locals: ReadonlyMap<string, SchemaValue>,
  resolve: (specifier: string) => ModuleExports | undefined,
  exports: Parameters<typeof addExport>[0],
): void {
  const from =
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? resolve(statement.moduleSpecifier.text)
      : undefined;
  const clause = statement.exportClause;
  if (clause === undefined) {
    if (from === undefined) return;
    for (const [name, table] of from.tables) exports.tables.set(name, table);
    for (const [name, keys] of from.objects) exports.objects.set(name, keys);
    for (const [name, namespace] of from.namespaces) {
      exports.namespaces.set(name, namespace);
    }
    return;
  }
  if (ts.isNamespaceExport(clause)) {
    if (from !== undefined) exports.namespaces.set(clause.name.text, from);
    return;
  }
  for (const element of clause.elements) {
    const name = (element.propertyName ?? element.name).text;
    addExport(
      exports,
      element.name.text,
      from === undefined ? locals.get(name) : exportedValue(from, name),
    );
  }
}

export interface SchemaCatalog {
  readonly declaredTables: readonly string[];
  readonly isSchemaModule: (filePath: string) => boolean;
  /**
   * What a module exports that reaches a table, through its imports, aliases,
   * and re-exports. Any module may re-export schema values, so importing
   * through it resolves to the same tables.
   */
  readonly moduleExports: (filePath: string) => ModuleExports;
  /** Every schema object key, for Drizzle's `db.query`. */
  readonly tablesByQueryKey: ReadonlyMap<string, string>;
  readonly tablesBySqlName: ReadonlyMap<string, string>;
}

export function readSchemaCatalog(
  sources: ReadonlyMap<string, ts.SourceFile>,
): SchemaCatalog {
  const declarationsByFile = new Map(
    [...sources]
      .map(([filePath, source]) => [filePath, declaredTables(source)] as const)
      .filter(([, declarations]) => declarations.length > 0),
  );
  const isSchemaModule = (filePath: string) =>
    declarationsByFile.has(filePath) || schemaDirectoryPattern.test(filePath);
  const knownFiles = new Set(sources.keys());
  const computed = new Map<string, ModuleExports>();
  const moduleExports = (filePath: string): ModuleExports => {
    const known = computed.get(filePath);
    if (known !== undefined) return known;
    const source = sources.get(filePath);
    if (source === undefined) return noExports;
    // A re-export cycle sees this module as empty until it is read.
    computed.set(filePath, noExports);
    const exports = readModuleExports(source, (specifier) => {
      const to = resolveRelativeImport(filePath, specifier, knownFiles);
      return to === undefined ? undefined : moduleExports(to);
    });
    computed.set(filePath, exports);
    return exports;
  };
  const declarations = [...declarationsByFile.values()].flat();
  const tablesByQueryKey = new Map<string, string>();
  for (const filePath of sources.keys()) {
    for (const keys of moduleExports(filePath).objects.values()) {
      for (const [key, table] of keys) tablesByQueryKey.set(key, table);
    }
  }
  return {
    declaredTables: declarations.map(({ name }) => name),
    isSchemaModule,
    moduleExports,
    tablesByQueryKey,
    tablesBySqlName: new Map(
      declarations.flatMap(({ name, sqlName }) =>
        sqlName === undefined ? [] : [[sqlName, name] as const],
      ),
    ),
  };
}
