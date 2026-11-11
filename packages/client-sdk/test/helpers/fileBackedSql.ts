import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import { createExecSql } from "../../src/data/sqlite/sqlSchema";

export async function openFileBackedSql(path: string) {
  const worker = new Worker(
    new URL("./fileBackedSqlWorker.ts", import.meta.url).href,
  );
  const client = createDatabaseWorkerClient(worker);
  const statements: string[] = [];
  // Count actual requests posted to the worker, not Drizzle builder calls.
  const postMessage = worker.postMessage.bind(worker);
  worker.postMessage = (message, transfer) => {
    if (message.method === "exec") statements.push(message.params.sql);
    if (Array.isArray(transfer)) postMessage(message, transfer);
    else postMessage(message, transfer);
  };
  try {
    await client.init({ dbName: path, cipher: "chacha20", key: "test-only" });
  } catch (error) {
    client.destroy();
    worker.terminate();
    throw error;
  }
  return {
    execSql: createExecSql(client),
    statements,
    async close() {
      try {
        await client.close();
      } finally {
        client.destroy();
        worker.terminate();
      }
    },
  };
}

export async function createFileBackedSql() {
  const directory = await mkdtemp(join(tmpdir(), "atomic-edit-"));
  const path = join(directory, "document.sqlite");
  const connection = await openFileBackedSql(path);
  return {
    ...connection,
    path,
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}
