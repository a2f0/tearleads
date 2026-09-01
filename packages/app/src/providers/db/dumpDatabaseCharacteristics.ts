import {
  createExecSql,
  type ExecSqlClientLike,
} from "@tearleads/client-sdk/sqlite";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";

interface TableCharacteristic {
  name: string;
  rows: number;
}

// Reads the sqlite_master catalog and a per-table COUNT(*) so we can report the
// mounted database's shape before any lazy table creation runs.
async function readDatabaseCharacteristics(
  client: ExecSqlClientLike,
): Promise<TableCharacteristic[]> {
  const execSql = createExecSql(client);
  // Array row mode lets us read columns positionally, avoiding index-signature
  // property access on the generic SqlRow record type.
  const tableRows = await execSql(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
    undefined,
    { rowMode: "array" },
  );

  // COUNT(*) is an O(N) scan per table, so issue the counts concurrently rather
  // than serially to keep boot-blocking time down. The worker serializes the
  // reads on its single connection, but this still pipelines the main-thread <->
  // worker round-trips instead of paying each latency in sequence.
  const characteristics = await Promise.all(
    tableRows.map(async ([name]): Promise<TableCharacteristic | null> => {
      if (typeof name !== "string") {
        return null;
      }

      // Table names come from sqlite_master, so quote-escape rather than bind
      // (identifiers cannot be parameterized) and count rows for each one.
      const quoted = `"${name.replace(/"/g, '""')}"`;
      const countRows = await execSql(
        `SELECT COUNT(*) FROM ${quoted}`,
        undefined,
        { rowMode: "array" },
      );
      const rows = countRows[0]?.[0];
      return { name, rows: typeof rows === "number" ? rows : 0 };
    }),
  );

  return characteristics.filter(
    (entry): entry is TableCharacteristic => entry !== null,
  );
}

// Logs the mounted database's table list and per-table row counts. Intended to
// run after the database is mounted but before features lazily create tables,
// so the output reflects on-disk state. Never throws: a dump failure must not
// block database boot.
export async function dumpDatabaseCharacteristics(
  client: ExecSqlClientLike,
  log: (message: string) => void,
): Promise<void> {
  try {
    const characteristics = await readDatabaseCharacteristics(client);
    if (characteristics.length === 0) {
      log("Database characteristics (pre-schema): no tables");
      return;
    }

    const totalRows = characteristics.reduce((sum, t) => sum + t.rows, 0);
    log(
      `Database characteristics (pre-schema): ${characteristics.length} table(s), ${totalRows} row(s) total`,
    );
    for (const { name, rows } of characteristics) {
      log(`  ${name}: ${rows} row(s)`);
    }
  } catch (error) {
    log(
      `Failed to read database characteristics: ${unknownErrorMessage(error)}`,
    );
  }
}
