import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../test/helpers/withTestExecSql";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  type ExecSql,
  resetConnectionSchemaMemo,
} from "../../data/sqlite/sqlSchema";
import { reclaimDocumentOrphanBlobs } from "./orphanBlobReclaims";

function fixture(execSql: ExecSql) {
  const queued = new Set<string>();
  const blobStore = createMemoryBlobStore();
  const runtime = {
    infra: {
      blobStore,
      dbStatus: "ready" as const,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    util: {
      log: (_message: string) => {},
      reportSecurityIncident: async () => undefined,
    },
  };
  const persistence = {
    ...sqlDocumentsPersistence,
    orphanBlobs: {
      acknowledge: async (_execSql: ExecSql, key: string) => {
        queued.delete(key);
      },
      isReferenced: async () => false,
      list: async () => [...queued],
      sweep: async () => false,
    },
  };
  return { queued, blobStore, runtime, persistence };
}

test("a requested rerun survives an interrupted reclaim batch", async () => {
  await withTestExecSql("orphan-rerun-error", async (execSql) => {
    const { queued, blobStore, runtime, persistence } = fixture(execSql);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    queued.add("orphan");
    await blobStore.writeBytes("orphan", new Uint8Array([1]));
    let first = true;
    persistence.orphanBlobs.list = async () => {
      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
        throw new Error("interrupted read");
      }
      return [...queued];
    };
    const initial = reclaimDocumentOrphanBlobs(runtime, persistence);
    await entered.promise;
    const joined = reclaimDocumentOrphanBlobs(runtime, persistence);
    release.resolve();
    await Promise.all([initial, joined]);
    expect(await blobStore.readBytes("orphan")).toBe(null);
    expect(queued.size).toBe(0);
  });
});

test("resetting a restored connection repeats its adapter's abandoned-row sweep", async () => {
  await withTestExecSql("orphan-sweep-restore", async (execSql) => {
    const { queued, blobStore, runtime, persistence } = fixture(execSql);
    let sweeps = 0;
    persistence.orphanBlobs.sweep = async () => {
      sweeps += 1;
      queued.add(`orphan-${sweeps}`);
      return false;
    };
    await blobStore.writeBytes("orphan-1", new Uint8Array([1]));
    await reclaimDocumentOrphanBlobs(runtime, persistence);
    expect(await blobStore.readBytes("orphan-1")).toBe(null);
    await blobStore.writeBytes("orphan-2", new Uint8Array([2]));
    resetConnectionSchemaMemo(execSql);
    await reclaimDocumentOrphanBlobs(runtime, persistence);
    expect(await blobStore.readBytes("orphan-2")).toBe(null);
    expect(sweeps).toBe(2);
  });
});

test("maintenance initialization errors do not escape into a committed write", async () => {
  await withTestExecSql("orphan-initialization-error", async (execSql) => {
    const { runtime, persistence } = fixture(execSql);
    const logs: string[] = [];
    runtime.util.log = (message: string) => {
      logs.push(message);
    };
    Object.defineProperty(persistence, "orphanBlobs", {
      get: () => {
        throw new Error("adapter unavailable");
      },
    });
    await expect(
      reclaimDocumentOrphanBlobs(runtime, persistence),
    ).resolves.toBeUndefined();
    expect(logs).toEqual([
      "Documents: orphan maintenance failed: adapter unavailable",
    ]);
  });
});
