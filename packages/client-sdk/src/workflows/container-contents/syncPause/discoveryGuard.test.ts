import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import { upsertDiscoveredDocumentsUnlessPaused } from "./discoveryGuard";

test("a listing that lands after its organization was paused stores nothing", async () => {
  const { close, execSql } = await createTestExecSql("discovery-pause-guard");
  try {
    let paused = false;
    const upserts: number[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A pause cleanup holds the lock while the listing arrives.
    const cleanup = runSerializedSqlMutation(execSql, async () => {
      await held;
      paused = true;
    });
    const write = upsertDiscoveredDocumentsUnlessPaused({
      execSql,
      inputs: [],
      isPaused: () => paused,
      upsert: async (_lockedExecSql, inputs) => {
        upserts.push(inputs.length);
        return [];
      },
    });
    release();
    await cleanup;

    expect(await write).toEqual([]);
    expect(upserts).toEqual([]);
  } finally {
    close();
  }
});
