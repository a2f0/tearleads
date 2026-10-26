import { expect, test } from "bun:test";
import {
  measureDatabase,
  parameterizedSql,
  repetitions,
  simpleSql,
} from "./probe";
import { probeFixture } from "./probe.testUtils";

test("separates acquisition and both serial protocols from a single-exchange batch", async () => {
  const pool = probeFixture();
  const result = await measureDatabase(pool);
  expect(pool.connect).toHaveBeenCalledTimes(1);
  expect(pool.calls[0]).toBe("BEGIN READ ONLY");
  expect(pool.calls.filter((sql) => sql === simpleSql)).toHaveLength(
    repetitions + 1,
  );
  expect(pool.calls.filter((sql) => sql === parameterizedSql)).toHaveLength(
    repetitions,
  );
  expect(pool.calls.filter((sql) => sql.includes(";"))).toHaveLength(1);
  expect(pool.calls.at(-1)).toBe("COMMIT");
  expect(result.simpleMs).toHaveLength(repetitions);
  expect(result.parameterizedMs).toHaveLength(repetitions);
  expect(result.planningMs).toBe(0.02);
  expect(result.executionMs).toBe(0.01);
  expect(pool.client.release).toHaveBeenCalledWith(false);
  expect(pool.end).toHaveBeenCalledTimes(1);
});

test("refuses a writable transaction, rolls back, and closes the connection", async () => {
  const pool = probeFixture("off");
  await expect(measureDatabase(pool)).rejects.toThrow("read-only");
  expect(pool.calls).not.toContain(simpleSql);
  expect(pool.calls.at(-1)).toBe("ROLLBACK");
  expect(pool.client.release).toHaveBeenCalledWith(true);
  expect(pool.end).toHaveBeenCalledTimes(1);
});

test("a failed query cannot leave its transaction and pool open", async () => {
  const pool = probeFixture();
  pool.client.query.mockRejectedValue(new Error("query failed"));
  await expect(measureDatabase(pool)).rejects.toThrow("query failed");
  expect(pool.client.query).toHaveBeenLastCalledWith("ROLLBACK");
  expect(pool.client.release).toHaveBeenCalledWith(true);
  expect(pool.end).toHaveBeenCalledTimes(1);
});

test("a failed connection still closes the pool", async () => {
  const pool = probeFixture();
  pool.connect.mockRejectedValue(new Error("connect failed"));
  await expect(measureDatabase(pool)).rejects.toThrow("connect failed");
  expect(pool.client.release).not.toHaveBeenCalled();
  expect(pool.end).toHaveBeenCalledTimes(1);
});
