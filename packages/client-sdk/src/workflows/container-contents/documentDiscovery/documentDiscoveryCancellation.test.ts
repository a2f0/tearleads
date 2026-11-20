import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  type DiscoveredDocumentCandidate,
  DocumentDiscoveryEvidenceRepository,
} from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { createExecSql } from "../../../data/sqlite/sqlSchema";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";

const at = "2026-09-23T00:00:00.000Z";
const candidate = (id: string): DiscoveredDocumentCandidate => ({
  documentId: id,
  containerId: "a",
  listedContainerIds: ["a"],
  accessEpoch: 1,
  accessStateHash: "signed-head",
  linkedContainerIds: ["forged"],
  createdAt: at,
});

test("cancelling during a head lookup leaves candidates immediately retryable", async () => {
  const { execSql, close } = await createTestExecSql(
    "cancel-discovery-evidence",
  );
  try {
    const controller = new AbortController();
    const store = new DocumentDiscoveryEvidenceRepository(
      execSql,
      () => 0,
      controller.signal,
    );
    const durable = new DocumentDiscoveryEvidenceRepository(execSql, () => 0);
    const inputs = Array.from({ length: 8 }, (_, i) => candidate(String(i)));
    let loads = 0;
    const results = Promise.withResolvers<null>();
    const first = Promise.withResolvers<void>();
    const verify = createDiscoveredDocumentVerifier(
      "org",
      async () => {
        loads++;
        first.resolve();
        return results.promise;
      },
      async () => 1,
      store,
    );
    const run = verify(inputs, ["a"], await store.begin());
    await first.promise;
    controller.abort();
    results.resolve(null);
    await expect(run).rejects.toThrow();
    expect(loads).toBeLessThan(inputs.length);
    expect(await durable.pending(["a"], inputs.length)).toHaveLength(
      inputs.length,
    );
  } finally {
    close();
  }
});

test("cancelling while reading retry attempts preserves the pending candidate", async () => {
  const { execSql, close } = await createTestExecSql(
    "cancel-discovery-backoff",
  );
  try {
    const controller = new AbortController();
    const observed = createExecSql({
      exec: async ({ sql, bind, rowMode }) => {
        const rows = await execSql(
          sql,
          bind,
          rowMode ? { rowMode } : undefined,
        );
        if (/^select "attempts" from/i.test(sql)) controller.abort();
        return { rows };
      },
    });
    const durable = new DocumentDiscoveryEvidenceRepository(execSql, () => 0);
    const interrupted = new DocumentDiscoveryEvidenceRepository(
      observed,
      () => 0,
      controller.signal,
    );
    const input = candidate("interrupted");
    const generation = await durable.begin();
    await durable.stage([input], generation);
    const [staged] = await durable.pending(["a"], 1);
    if (!staged) throw new Error("Missing staged candidate");
    await expect(interrupted.defer(staged, generation)).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
    expect(await durable.pending(["a"], 1)).toEqual([staged]);
  } finally {
    close();
  }
});
