import * as ts from "typescript";

// Schema modules declare tables or gather them into table lists; they are the
// SQLite Runtime's catalog, not users of another subsystem's data.
const schemaDirectoryPattern = /\/sqlite\/schema\//;
// Alias chains, re-exports, and property hops a table resolves through.
const maxResolutionDepth = 16;

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

/** Each `sqliteTable` export in the file, with the SQL name it declares. */
function declaredTables(
  source: ts.SourceFile,
): { name: ts.Identifier; sqlName: string | undefined }[] {
  return source.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) {
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
          name: declaration.name,
          sqlName:
            sqlName !== undefined && ts.isStringLiteral(sqlName)
              ? sqlName.text
              : undefined,
        },
      ];
    });
  });
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

/** The literal key a property or binding name names, if any. */
export function literalKey(
  node: ts.PropertyName | ts.BindingName,
): string | undefined {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node)
  ) {
    return node.text;
  }
  return ts.isComputedPropertyName(node)
    ? elementKey(node.expression)
    : undefined;
}

/** The literal key an element access or computed name indexes by, if any. */
export function elementKey(expression: ts.Expression): string | undefined {
  return ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)
    ? expression.text
    : undefined;
}

export interface TableCatalog {
  readonly declaredTables: readonly string[];
  readonly isSchemaModule: (filePath: string) => boolean;
  readonly resolver: TableResolver;
  /** Every schema object key, for Drizzle's `db.query`. */
  readonly tablesByQueryKey: ReadonlyMap<string, string>;
  readonly tablesBySqlName: ReadonlyMap<string, string>;
}

/**
 * Resolves symbols to the `sqliteTable` declarations they stand for, with the
 * type checker: imports, re-exports, aliases, scopes, and cycles resolve the
 * way the compiler resolves them.
 */
export class TableResolver {
  private readonly memo = new Map<ts.Symbol, string | null>();

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly tableBySymbol: ReadonlyMap<ts.Symbol, string>,
  ) {}

  /** The table a symbol stands for, through aliases and properties. */
  symbol(symbol: ts.Symbol | undefined, depth = 0): string | undefined {
    if (symbol === undefined || depth > maxResolutionDepth) return undefined;
    const target =
      symbol.flags & ts.SymbolFlags.Alias
        ? this.checker.getAliasedSymbol(symbol)
        : symbol;
    const table = this.tableBySymbol.get(target);
    if (table !== undefined) return table;
    if (this.memo.has(target)) return this.memo.get(target) ?? undefined;
    this.memo.set(target, null);
    const resolved = this.declaration(
      target.valueDeclaration ?? target.declarations?.[0],
      depth + 1,
    );
    this.memo.set(target, resolved ?? null);
    return resolved;
  }

  /** The table a property of an expression's or pattern's type holds. */
  property(
    owner: ts.Expression | ts.BindingPattern,
    key: string,
    depth = 0,
  ): string | undefined {
    return this.symbol(
      this.checker.getTypeAtLocation(owner).getProperty(key),
      depth,
    );
  }

  /** The table an expression evaluates to, through aliases and properties. */
  expression(expression: ts.Expression, depth = 0): string | undefined {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      return this.symbol(this.checker.getSymbolAtLocation(node), depth);
    }
    if (ts.isPropertyAccessExpression(node)) {
      return this.symbol(this.checker.getSymbolAtLocation(node.name), depth);
    }
    if (!ts.isElementAccessExpression(node)) return undefined;
    const key = elementKey(node.argumentExpression);
    return key === undefined
      ? undefined
      : this.property(node.expression, key, depth);
  }

  /** The table a qualified name in a type, `schema.documents`, names. */
  qualifiedName(name: ts.QualifiedName): string | undefined {
    return this.symbol(this.checker.getSymbolAtLocation(name.right));
  }

  /** Whether an expression is Drizzle's relational `db.query`, through aliases. */
  isRelational(expression: ts.Expression, depth = 0): boolean {
    const node = unwrap(expression);
    if (ts.isPropertyAccessExpression(node)) return node.name.text === "query";
    if (ts.isElementAccessExpression(node)) {
      return elementKey(node.argumentExpression) === "query";
    }
    if (!ts.isIdentifier(node) || depth > maxResolutionDepth) return false;
    const symbol = this.checker.getSymbolAtLocation(node);
    const declaration = (
      symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
        ? this.checker.getAliasedSymbol(symbol)
        : symbol
    )?.valueDeclaration;
    if (declaration !== undefined && ts.isBindingElement(declaration)) {
      return declaration.dotDotDotToken
        ? this.isRelationalPattern(declaration.parent, depth + 1)
        : literalKey(declaration.propertyName ?? declaration.name) === "query";
    }
    return (
      declaration !== undefined &&
      (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) &&
      declaration.initializer !== undefined &&
      this.isRelational(declaration.initializer, depth + 1)
    );
  }

  /** Whether a pattern destructures Drizzle's relational `db.query`. */
  isRelationalPattern(pattern: ts.BindingPattern, depth = 0): boolean {
    const holder = pattern.parent;
    if (ts.isBindingElement(holder)) {
      return (
        !holder.dotDotDotToken &&
        literalKey(holder.propertyName ?? holder.name) === "query"
      );
    }
    return (
      holder.initializer !== undefined &&
      this.isRelational(holder.initializer, depth)
    );
  }

  /** The property names of an expression's or pattern's type. */
  propertyNames(expression: ts.Expression | ts.BindingPattern): string[] {
    return this.checker
      .getTypeAtLocation(expression)
      .getProperties()
      .map((property) => property.name);
  }

  /** Every table an expression's type exposes as a property. */
  typeTables(expression: ts.Expression | ts.BindingPattern): string[] {
    return [
      ...new Set(
        this.checker
          .getTypeAtLocation(expression)
          .getProperties()
          .flatMap((property) => {
            const table = this.symbol(property);
            return table === undefined ? [] : [table];
          }),
      ),
    ];
  }

  private declaration(
    declaration: ts.Declaration | undefined,
    depth: number,
  ): string | undefined {
    if (declaration === undefined) return undefined;
    if (ts.isShorthandPropertyAssignment(declaration)) {
      return this.symbol(
        this.checker.getShorthandAssignmentValueSymbol(declaration),
        depth,
      );
    }
    if (
      ts.isPropertyAssignment(declaration) ||
      ((ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) &&
        ts.isIdentifier(declaration.name))
    ) {
      return declaration.initializer === undefined
        ? undefined
        : this.expression(declaration.initializer, depth);
    }
    if (!ts.isBindingElement(declaration) || declaration.dotDotDotToken) {
      return undefined;
    }
    const key = literalKey(declaration.propertyName ?? declaration.name);
    return key === undefined
      ? undefined
      : this.property(declaration.parent, key, depth);
  }
}

function readTableSymbols(
  checker: ts.TypeChecker,
  sources: readonly (readonly [string, ts.SourceFile])[],
): {
  declaringFiles: Set<string>;
  tableBySymbol: Map<ts.Symbol, string>;
  tablesBySqlName: Map<string, string>;
} {
  const tableBySymbol = new Map<ts.Symbol, string>();
  const tablesBySqlName = new Map<string, string>();
  const declaringFiles = new Set<string>();
  for (const [filePath, source] of sources) {
    for (const { name, sqlName } of declaredTables(source)) {
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol !== undefined) tableBySymbol.set(symbol, name.text);
      if (sqlName !== undefined) tablesBySqlName.set(sqlName, name.text);
      declaringFiles.add(filePath);
    }
  }
  return { declaringFiles, tableBySymbol, tablesBySqlName };
}

/** Drizzle's `schema` option builds the database `db.query` reads through. */
export function isDrizzleSchemaOption(node: ts.Expression): boolean {
  const option = node.parent;
  const call = option.parent?.parent;
  return (
    ts.isPropertyAssignment(option) &&
    option.initializer === node &&
    literalKey(option.name) === "schema" &&
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "drizzle"
  );
}

/** Schema values: exported schema objects and whatever reaches `drizzle`. */
function schemaValues(
  sources: readonly (readonly [string, ts.SourceFile])[],
  isSchemaModule: (filePath: string) => boolean,
): ts.Node[] {
  const values: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isExpression(node) && isDrizzleSchemaOption(node)) values.push(node);
    ts.forEachChild(node, visit);
  };
  for (const [filePath, source] of sources) {
    visit(source);
    if (!isSchemaModule(filePath)) continue;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !isExported(statement)) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          initializer !== undefined &&
          ts.isObjectLiteralExpression(unwrap(initializer))
        ) {
          values.push(declaration.name);
        }
      }
    }
  }
  return values;
}

/**
 * The keys Drizzle's `db.query` serves tables under: each table's export name,
 * as a schema module namespace keys it, and every key of a schema value.
 */
function readQueryKeys(
  checker: ts.TypeChecker,
  schemaNodes: readonly ts.Node[],
  resolver: TableResolver,
  tableNames: Iterable<string>,
): Map<string, string> {
  const tablesByQueryKey = new Map<string, string>();
  for (const table of tableNames) tablesByQueryKey.set(table, table);
  for (const node of schemaNodes) {
    for (const property of checker.getTypeAtLocation(node).getProperties()) {
      const table = resolver.symbol(property);
      if (table !== undefined) tablesByQueryKey.set(property.name, table);
    }
  }
  return tablesByQueryKey;
}

export function readTableCatalog(
  program: ts.Program,
  files: readonly string[],
): TableCatalog {
  const checker = program.getTypeChecker();
  const sources = files.flatMap((filePath) => {
    const source = program.getSourceFile(filePath);
    return source === undefined ? [] : [[filePath, source] as const];
  });
  const { declaringFiles, tableBySymbol, tablesBySqlName } = readTableSymbols(
    checker,
    sources,
  );
  const isSchemaModule = (filePath: string) =>
    declaringFiles.has(filePath) || schemaDirectoryPattern.test(filePath);
  const resolver = new TableResolver(checker, tableBySymbol);
  return {
    declaredTables: [...new Set(tableBySymbol.values())],
    isSchemaModule,
    resolver,
    tablesByQueryKey: readQueryKeys(
      checker,
      schemaValues(sources, isSchemaModule),
      resolver,
      tableBySymbol.values(),
    ),
    tablesBySqlName,
  };
}
