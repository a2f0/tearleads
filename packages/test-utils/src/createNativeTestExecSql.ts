import { Database } from "bun:sqlite";

/**
 * An `ExecSql` over Bun's built-in SQLite, for tests that must run without
 * the `@tearleads/sqlite-instance` WebAssembly build (the always-on lint
 * job runs `check:fast` before any package build). Same contract as
 * `createTestExecSql`: object rows by default, array rows on request,
 * positional or named binds. Not the production engine, so use it where the
 * code under test is the verifier, not the SQLite layer.
 */

type NativeSqlValue = string | number | null;
type NativeSqlRow = Record<string, NativeSqlValue>;
type NativeSqlBind =
  | Record<string, NativeSqlValue>
  | ReadonlyArray<NativeSqlValue>;

export interface NativeTestExecSql {
  (
    sql: string,
    bind?: NativeSqlBind,
    options?: { rowMode?: "object" },
  ): Promise<NativeSqlRow[]>;
  (
    sql: string,
    bind: NativeSqlBind | undefined,
    options: { rowMode: "array" },
  ): Promise<NativeSqlValue[][]>;
  (
    sql: string,
    bind?: NativeSqlBind,
    options?: { rowMode?: "object" | "array" },
  ): Promise<Array<NativeSqlRow | NativeSqlValue[]>>;
}

/** bun:sqlite wants named binds keyed with their prefix character. */
function nativeBind(
  bind: NativeSqlBind | undefined,
): Record<string, NativeSqlValue> | NativeSqlValue[] | undefined {
  if (bind === undefined) return undefined;
  if (Array.isArray(bind)) return [...bind];
  return Object.fromEntries(
    Object.entries(bind).map(([key, value]) => [
      /^[$:@]/.test(key) ? key : `$${key}`,
      value,
    ]),
  );
}

function isSingleStatement(sql: string): boolean {
  return !/;\s*\S/.test(sql.trim().replace(/;\s*$/, ""));
}

export function createNativeTestExecSql(): {
  readonly close: () => void;
  readonly execSql: NativeTestExecSql;
} {
  const database = new Database(":memory:");
  const execSql = (async (
    sql: string,
    bind?: NativeSqlBind,
    options?: { rowMode?: "object" | "array" },
  ) => {
    const parameters = nativeBind(bind);
    if (parameters === undefined && !isSingleStatement(sql)) {
      database.run(sql);
      return [];
    }
    const statement = database.query(sql);
    try {
      const rows =
        options?.rowMode === "array"
          ? parameters === undefined
            ? statement.values()
            : statement.values(parameters as never)
          : parameters === undefined
            ? statement.all()
            : statement.all(parameters as never);
      return rows as Array<NativeSqlRow | NativeSqlValue[]>;
    } finally {
      statement.finalize();
    }
  }) as NativeTestExecSql;
  return { close: () => database.close(), execSql };
}
