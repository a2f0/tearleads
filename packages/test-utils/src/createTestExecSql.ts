import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";

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

export async function createTestExecSql(key: string): Promise<{
  close: () => void;
  execSql: TestExecSql;
}> {
  const db = await initDatabase({
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
