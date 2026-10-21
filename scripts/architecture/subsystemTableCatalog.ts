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

function exportStatementTables(
  statement: ts.ExportDeclaration,
  filePath: string,
  knownFiles: ReadonlySet<string>,
  tables: ReadonlySet<string>,
  exportsOf: (filePath: string) => readonly string[],
): readonly string[] {
  const clause = statement.exportClause;
  if (clause !== undefined && ts.isNamedExports(clause)) {
    return clause.elements
      .map((element) => (element.propertyName ?? element.name).text)
      .filter((name) => tables.has(name));
  }
  const specifier = statement.moduleSpecifier;
  const to =
    specifier !== undefined && ts.isStringLiteral(specifier)
      ? resolveRelativeImport(filePath, specifier.text, knownFiles)
      : undefined;
  return to === undefined ? [] : exportsOf(to);
}

function schemaModuleExports(
  filePath: string,
  sources: ReadonlyMap<string, ts.SourceFile>,
  tables: ReadonlySet<string>,
  exportsOf: (filePath: string) => readonly string[],
): string[] {
  const source = sources.get(filePath);
  if (source === undefined) return [];
  const knownFiles = new Set(sources.keys());
  const names = new Set(declaredTables(source).map(({ name }) => name));
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    for (const name of exportStatementTables(
      statement,
      filePath,
      knownFiles,
      tables,
      exportsOf,
    )) {
      names.add(name);
    }
  }
  return [...names];
}

export interface SchemaCatalog {
  /** The tables a schema module exports, through its re-exports too. */
  readonly exportedTables: (filePath: string) => readonly string[];
  readonly isSchemaModule: (filePath: string) => boolean;
  readonly schemaObjectNames: ReadonlySet<string>;
  readonly tables: ReadonlySet<string>;
  readonly tablesBySchemaKey: ReadonlyMap<string, string>;
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
  const declarations = [...declarationsByFile.values()].flat();
  const tables = new Set(declarations.map(({ name }) => name));
  const schemaObjectKeys = [...sources].flatMap(([filePath, source]) =>
    isSchemaModule(filePath) ? schemaObjectTableKeys(source, tables) : [],
  );
  const exported = new Map<string, readonly string[]>();
  const exportedTables = (filePath: string): readonly string[] => {
    const known = exported.get(filePath);
    if (known !== undefined) return known;
    // A re-export cycle stops here with the tables found so far.
    exported.set(filePath, []);
    const names = schemaModuleExports(filePath, sources, tables, (to) =>
      isSchemaModule(to) ? exportedTables(to) : [],
    );
    exported.set(filePath, names);
    return names;
  };
  return {
    exportedTables,
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
