import { dirname, join, normalize } from "node:path";
import * as ts from "typescript";

// Schema modules declare tables or gather them into table lists; they are the
// SQLite Runtime's catalog, not users of another subsystem's data.
const schemaDirectoryPattern = /\/sqlite\/schema\//;
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

function schemaKeysReadAt(node: ts.Node, roots: SchemaRoots): string[] {
  const key = accessedKey(node);
  if (key !== undefined) {
    const target = (
      node as ts.PropertyAccessExpression | ts.ElementAccessExpression
    ).expression;
    return isSchemaRoot(target, roots) ? [key] : [];
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isObjectBindingPattern(node.name) &&
    node.initializer !== undefined &&
    isSchemaRoot(node.initializer, roots)
  ) {
    return node.name.elements.flatMap((element) => {
      const name = element.propertyName ?? element.name;
      return ts.isIdentifier(name) ? [name.text] : [];
    });
  }
  return [];
}

/**
 * Names a file reads off a schema root: a schema module namespace, an imported
 * schema object, a schema object reached through a namespace, or Drizzle's
 * `db.query`. Property access, a literal index, and destructuring all count.
 * Passing a whole root along, as SQLite Runtime does to build the Drizzle
 * database, names nothing.
 */
export function schemaKeysReadInSource(
  source: ts.SourceFile,
  roots: SchemaRoots,
): Set<string> {
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    for (const key of schemaKeysReadAt(node, roots)) keys.add(key);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
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
): { objects: string[]; tables: string[] } {
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
      .map(({ name }) => name),
  };
}

/**
 * Reads one file's schema imports: tables it imports or re-exports by name,
 * every table for a wholesale `export *`, and the namespaces and schema objects
 * it binds for `schemaKeysReadInSource`.
 */
function readSchemaImports(
  from: string,
  source: ts.SourceFile,
  catalog: SchemaCatalog,
  knownFiles: ReadonlySet<string>,
): { roots: SchemaRoots; tables: string[] } {
  const namespaces = new Set<string>();
  const objects = new Set<string>();
  const tables: string[] = [];
  for (const statement of source.statements) {
    if (!targetsSchemaModule(statement, from, catalog, knownFiles)) continue;
    const isImport = ts.isImportDeclaration(statement);
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    if (bindings === undefined || ts.isNamespaceExport(bindings)) {
      tables.push(...catalog.tables);
      continue;
    }
    const named = readNamedSchemaImports(bindings, catalog);
    tables.push(...named.tables);
    if (isImport) for (const object of named.objects) objects.add(object);
  }
  return {
    roots: {
      namespaces,
      objects,
      schemaObjectNames: catalog.schemaObjectNames,
    },
    tables,
  };
}

/** Table uses in parsed production sources, outside schema modules. */
export function findTableUsesInSources(
  sources: ReadonlyMap<string, ts.SourceFile>,
): { declaredTables: string[]; uses: SubsystemTableUse[] } {
  const catalog = readSchemaCatalog(sources);
  const knownFiles = new Set(sources.keys());
  const uses = new Map<string, SubsystemTableUse>();
  for (const [from, source] of sources) {
    if (catalog.isSchemaModule(from)) continue;
    const imports = readSchemaImports(from, source, catalog, knownFiles);
    const tableOf = (name: string) =>
      catalog.tablesBySchemaKey.get(name) ??
      (catalog.tables.has(name) ? name : undefined);
    const tables = [
      ...imports.tables,
      ...[...schemaKeysReadInSource(source, imports.roots)].map(tableOf),
      ...[...rawSqlTableNames(source)].map((sqlName) =>
        catalog.tablesBySqlName.get(sqlName),
      ),
    ];
    for (const table of tables) {
      if (table !== undefined) uses.set(`${from} -> ${table}`, { from, table });
    }
  }
  return { declaredTables: [...catalog.tables], uses: [...uses.values()] };
}
