import { jsonRecord } from "../jsonRecord";

export const repetitions = 20;
export const simpleSql = "SELECT 1 AS value";
export const parameterizedSql = "SELECT $1::integer AS value";

export interface ProbeClient {
  query(sql: string, values?: unknown[]): Promise<unknown>;
  release(destroy?: boolean): void;
}

export interface ProbePool {
  connect(): Promise<ProbeClient>;
  end(): Promise<void>;
}

function firstRow(result: unknown) {
  const rows = Reflect.get(jsonRecord(result), "rows");
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error("Unexpected probe result size.");
  return jsonRecord(rows[0]);
}

function checkConstant(result: unknown) {
  if (Reflect.get(firstRow(result), "value") !== 1)
    throw new Error("Unexpected probe result.");
}

function milliseconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Missing server timing.");
  return value;
}

export async function measureDatabase(pool: ProbePool) {
  const started = performance.now();
  let client: ProbeClient | undefined;
  let committed = false;
  try {
    client = await pool.connect();
    const connectMs = performance.now() - started;
    const connection = client;
    async function query(sql: string, values?: unknown[]) {
      const start = performance.now();
      const result = await connection.query(sql, values);
      return { result, ms: performance.now() - start };
    }
    const begin = await query("BEGIN READ ONLY");
    await query("SET LOCAL statement_timeout = '2000ms'");
    await query("SET LOCAL idle_in_transaction_session_timeout = '5000ms'");
    const readOnly = await query("SHOW transaction_read_only");
    if (
      Reflect.get(firstRow(readOnly.result), "transaction_read_only") !== "on"
    )
      throw new Error("Probe requires a read-only transaction.");

    const first = await query(simpleSql);
    checkConstant(first.result);
    const simpleMs: number[] = [];
    const parameterizedMs: number[] = [];
    // Interleave the protocols so their comparison is less sensitive to drift.
    for (let index = 0; index < repetitions; index++) {
      const simple = await query(simpleSql);
      checkConstant(simple.result);
      simpleMs.push(simple.ms);
      const parameterized = await query(parameterizedSql, [1]);
      checkConstant(parameterized.result);
      parameterizedMs.push(parameterized.ms);
    }
    // Same twenty constant SELECTs, sent in one simple-protocol exchange.
    const batch = await query(Array(repetitions).fill(simpleSql).join("; "));
    if (!Array.isArray(batch.result) || batch.result.length !== repetitions)
      throw new Error("Unexpected batch result size.");
    for (const result of batch.result) checkConstant(result);
    const explain = await query(
      `EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ${parameterizedSql}`,
      [1],
    );
    const plans = firstRow(explain.result)["QUERY PLAN"];
    if (!Array.isArray(plans) || plans.length !== 1)
      throw new Error("Unexpected explain result.");
    const plan = jsonRecord(plans[0]);
    const planningMs = milliseconds(plan["Planning Time"]);
    const executionMs = milliseconds(plan["Execution Time"]);
    const commit = await query("COMMIT");
    committed = true;
    return {
      connectMs,
      beginMs: begin.ms,
      firstQueryMs: first.ms,
      simpleMs,
      parameterizedMs,
      batchMs: batch.ms,
      explainRoundTripMs: explain.ms,
      planningMs,
      executionMs,
      commitMs: commit.ms,
      elapsedMs: performance.now() - started,
      repetitions,
    };
  } finally {
    if (client) {
      if (!committed) await client.query("ROLLBACK").catch(() => {});
      client.release(!committed);
    }
    await pool.end();
  }
}

export type DatabaseMeasurement = Awaited<ReturnType<typeof measureDatabase>>;
