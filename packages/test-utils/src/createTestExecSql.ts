import {
  execDatabaseStatement,
  initDatabase,
} from "@symcrypt/sqlite-worker/load-sqlite3";

let expectedSqliteWarningSuppressionDepth = 0;
let originalConsoleWarn: typeof console.warn | null = null;

function isExpectedMainThreadOpfsWarning(args: readonly unknown[]): boolean {
  return (
    args[0] === "Ignoring inability to install OPFS sqlite3_vfs:" &&
    String(args[1]).includes(
      "The OPFS sqlite3_vfs cannot run in the main thread",
    )
  );
}

async function withExpectedSqliteWarningsSuppressed<T>(
  run: () => Promise<T>,
): Promise<T> {
  if (expectedSqliteWarningSuppressionDepth === 0) {
    originalConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (isExpectedMainThreadOpfsWarning(args)) {
        return;
      }

      originalConsoleWarn?.(...args);
    };
  }
  expectedSqliteWarningSuppressionDepth += 1;

  try {
    return await run();
  } finally {
    expectedSqliteWarningSuppressionDepth -= 1;
    if (expectedSqliteWarningSuppressionDepth === 0 && originalConsoleWarn) {
      console.warn = originalConsoleWarn;
      originalConsoleWarn = null;
    }
  }
}

type TestSqlRowValue = string | number | null;
type TestSqlRow = Record<string, TestSqlRowValue>;
type TestSqlArrayRow = TestSqlRowValue[];
type TestSqlBind =
  | Record<string, TestSqlRowValue>
  | ReadonlyArray<TestSqlRowValue>;
type TestSqlRowMode = "object" | "array";

export interface TestExecSql {
  (
    sql: string,
    bind?: TestSqlBind,
    options?: { rowMode?: "object" },
  ): Promise<TestSqlRow[]>;
  (
    sql: string,
    bind: TestSqlBind | undefined,
    options: { rowMode: "array" },
  ): Promise<TestSqlArrayRow[]>;
  (
    sql: string,
    bind?: TestSqlBind,
    options?: { rowMode?: TestSqlRowMode },
  ): Promise<Array<TestSqlRow | TestSqlArrayRow>>;
}

function createTestExecSqlAdapter(client: {
  exec(options: {
    sql: string;
    bind?: TestSqlBind;
    rowMode?: TestSqlRowMode;
  }): Promise<{ rows: Array<TestSqlRow | TestSqlArrayRow> }>;
}): TestExecSql {
  function execSql(
    sql: string,
    bind?: TestSqlBind,
    options?: { rowMode?: "object" },
  ): Promise<TestSqlRow[]>;
  function execSql(
    sql: string,
    bind: TestSqlBind | undefined,
    options: { rowMode: "array" },
  ): Promise<TestSqlArrayRow[]>;
  function execSql(
    sql: string,
    bind?: TestSqlBind,
    options?: { rowMode?: TestSqlRowMode },
  ): Promise<Array<TestSqlRow | TestSqlArrayRow>>;
  async function execSql(
    sql: string,
    bind?: TestSqlBind,
    options?: { rowMode?: TestSqlRowMode },
  ): Promise<Array<TestSqlRow | TestSqlArrayRow>> {
    const result = await client.exec({
      sql,
      ...(bind !== undefined ? { bind } : {}),
      ...(options?.rowMode ? { rowMode: options.rowMode } : {}),
    });
    return result.rows;
  }

  return execSql;
}

export async function initTestSqliteDatabase(
  options: Parameters<typeof initDatabase>[0],
): ReturnType<typeof initDatabase> {
  return withExpectedSqliteWarningsSuppressed(() => initDatabase(options));
}

export async function createTestExecSql(key: string): Promise<{
  close: () => void;
  execSql: TestExecSql;
}> {
  const db = await initTestSqliteDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key,
  });

  return {
    close: () => db.close(),
    execSql: createTestExecSqlAdapter({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options),
      }),
    }),
  };
}
