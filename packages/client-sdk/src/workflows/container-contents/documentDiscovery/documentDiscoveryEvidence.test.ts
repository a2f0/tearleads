import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  type DiscoveredDocumentCandidate,
  DocumentDiscoveryEvidenceRepository,
} from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { documentContainerProjectionTables } from "../../../data/sqlite/schema/documentProjectionSchema";
import { ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import {
  discoverContainerDocuments,
  laneLister,
  nullContainerDocumentWatermarks,
  pinTestDiscoveryHead,
} from "./documentDiscovery.testUtils";
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
const head = {
  organizationId: "org",
  accessEpoch: 1,
  accessStateHash: "signed-head",
  linkedContainerIds: ["a"],
};

test("unavailable discoveries back off independently and a bounded prefix survives restart", async () => {
  const { execSql, close } = await createTestExecSql("discovery-bounded-retry");
  try {
    let now = 0;
    let recovered = false;
    let calls = 0;
    const load = async (id: string) => {
      calls += 1;
      return id === "doc-00" && !recovered ? null : head;
    };
    const store = new DocumentDiscoveryEvidenceRepository(execSql, () => now);
    const first = await createDiscoveredDocumentVerifier(
      "org",
      load,
      async () => 1,
      store,
    )(
      Array.from({ length: 40 }, (_, i) =>
        candidate(`doc-${String(i).padStart(2, "0")}`),
      ),
      ["a"],
      await store.begin(),
    );
    expect(calls).toBe(32);
    expect(first.inputs).toHaveLength(31);
    expect(await first.commit()).toBe(false);
    // A recreated adapter picks up the remaining eight without retrying the
    // unavailable document or relying on closure-local progress.
    const reopened = new DocumentDiscoveryEvidenceRepository(
      execSql,
      () => now,
    );
    const verify = createDiscoveredDocumentVerifier(
      "org",
      load,
      async () => 1,
      reopened,
    );
    const second = await verify([], ["a"], await reopened.begin());
    expect(second.inputs).toHaveLength(8);
    expect(calls).toBe(40);
    expect(await second.commit()).toBe(false);
    recovered = true;
    now = 15 * 60_000 + 1;
    const retry = await verify([], ["a"], await reopened.begin());
    expect(retry.inputs.map((input) => input.documentId)).toEqual(["doc-00"]);
    expect(await retry.commit()).toBe(true);
  } finally {
    close();
  }
});

test("matching signed heads avoid repeat fetches and changed candidates survive old acknowledgements", async () => {
  const { execSql, close } = await createTestExecSql(
    "discovery-evidence-cache",
  );
  try {
    const store = new DocumentDiscoveryEvidenceRepository(execSql);
    let calls = 0;
    const verify = createDiscoveredDocumentVerifier(
      "org",
      async () => {
        calls++;
        return head;
      },
      async () => 1,
      store,
    );
    await pinTestDiscoveryHead(execSql, "doc", "signed-head");
    const first = await verify([candidate("doc")], ["a"], await store.begin());
    expect(await store.hasPending(["a"])).toBe(true); // Local apply has not committed yet.
    expect(await first.commit()).toBe(true);
    const repeated = await verify(
      [candidate("doc")],
      ["a"],
      await store.begin(),
    );
    expect(calls).toBe(1);
    expect(repeated.inputs[0]?.linkedContainerIds).toEqual(["a"]);
    const lookups: (string | undefined)[] = [];
    const conflicting = createDiscoveredDocumentVerifier(
      "org",
      async (_id, hash) => {
        lookups.push(hash);
        return head;
      },
      async () => 1,
      store,
    );
    const live = await conflicting(
      [candidate("doc")],
      ["a"],
      await store.begin(),
      [],
      new Set(["doc"]),
    );
    // An omitted hash evicts a transport-cached projection before the request.
    expect(lookups).toEqual([undefined]);
    expect(live.inputs[0]?.linkedContainerIds).toEqual(["a"]);
    await store.stage(
      [{ ...candidate("doc"), accessEpoch: 2, accessStateHash: "new-head" }],
      await store.begin(),
    );
    expect(await repeated.commit()).toBe(false);
    expect((await store.pending(["a"], 32))[0]?.accessEpoch).toBe(2);
  } finally {
    close();
  }
});

test("a deferred live and unlink conflict still requires the current signed head after restart", async () => {
  const { execSql, close } = await createTestExecSql(
    "discovery-conflict-restart",
  );
  try {
    let now = 0;
    const store = new DocumentDiscoveryEvidenceRepository(execSql, () => now);
    const original = candidate("doc");
    await pinTestDiscoveryHead(execSql, "doc", "signed-head");
    await store.saveHead("doc", head, await store.begin());
    const unavailable = createDiscoveredDocumentVerifier(
      "org",
      async () => null,
      async () => 1,
      store,
    );
    const waiting = await unavailable(
      [original],
      ["a"],
      await store.begin(),
      [],
      new Set(["doc"]),
    );
    expect(waiting.inputs).toEqual([]);
    expect(await waiting.commit()).toBe(false);
    now = 15 * 60_000 + 1;
    const reopened = new DocumentDiscoveryEvidenceRepository(
      execSql,
      () => now,
    );
    const requests: (string | undefined)[] = [];
    const retry = createDiscoveredDocumentVerifier(
      "org",
      async (_id, hash) => {
        requests.push(hash);
        return {
          ...head,
          accessEpoch: 2,
          accessStateHash: "after-unlink",
          linkedContainerIds: [],
        };
      },
      async () => 1,
      reopened,
    );
    // A repeated live candidate can arrive independently of the already
    // checkpointed unlink. It cannot clear the pending freshness requirement.
    const result = await retry([original], ["a"], await reopened.begin());
    expect(requests).toEqual([undefined]);
    expect(result.inputs).toEqual([]);
    expect(await result.commit()).toBe(true);
  } finally {
    close();
  }
});

for (const available of [true, false]) {
  test(`discovery advances the lane on signed-head evidence (head available=${available})`, async () => {
    const { execSql, close } = await createTestExecSql(
      `discovery-lanes-${available}`,
    );
    try {
      const store = new DocumentDiscoveryEvidenceRepository(execSql);
      const saved: string[] = [];
      const inputs: unknown[] = [];
      let retries = 0;
      const result = await discoverContainerDocuments({
        ...nullContainerDocumentWatermarks,
        containerId: "b",
        beginDocumentDiscovery: () => store.begin(),
        listContainerDocumentLanes: laneLister(async () => ({
          hasMore: false,
          nextWatermark: { id: "doc", updatedAt: at },
          tombstones: [],
          items: [
            {
              id: "doc",
              createdAt: at,
              updatedAt: at,
              currentAccessEpoch: 1,
              currentAccessStateHash: "signed-head",
              linkedContainerIds: ["a", "b"],
              referencedPrincipals: [],
            },
          ],
        })),
        listHeldContainerDocumentTombstones: async () => {
          retries++;
          return [];
        },
        verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
          "org",
          async () =>
            available ? { ...head, linkedContainerIds: ["b"] } : null,
          async () => 1,
          store,
        ),
        upsertDiscoveredDocuments: async (values) => {
          inputs.push(...values);
          return values.map((value) => ({
            id: value.documentId,
            documentId: value.documentId,
            containerId: value.containerId,
            title: "doc",
            updatedAt: at,
          }));
        },
        replaceDocumentLinksBatch: async () => {},
        saveContainerDocumentWatermark: async (id) => {
          saved.push(id);
        },
      });
      expect(saved).toEqual(["b"]);
      expect(retries).toBeGreaterThan(0);
      if (available) {
        expect(result).toHaveLength(1);
        expect(inputs).toMatchObject([
          { containerId: "b", linkedContainerIds: ["b"] },
        ]);
      } else {
        expect(result).toBeNull();
        expect(inputs).toEqual([]);
        expect(await store.hasPending(["b"])).toBe(true);
      }
    } finally {
      close();
    }
  });
}

test("an old hold table fails with the reset diagnosis before querying hidden", async () => {
  const { execSql, close } = await createTestExecSql(
    "discovery-old-hold-schema",
  );
  try {
    await execSql(
      "CREATE TABLE container_document_tombstone_holds (document_id TEXT, container_id TEXT, tombstoned_at TEXT, attempts INTEGER, updated_at TEXT)",
    );
    await expect(
      ensureSqlTables(execSql, documentContainerProjectionTables),
    ).rejects.toThrow("reset");
  } finally {
    close();
  }
});

test("local request order replaces inflated epochs and ignores older overlapping listings", async () => {
  const { execSql, close } = await createTestExecSql("discovery-request-order");
  try {
    const store = new DocumentDiscoveryEvidenceRepository(execSql);
    const older = await store.begin();
    const newer = await store.begin();
    await store.stage([{ ...candidate("doc"), accessEpoch: 1_000_000 }], older);
    await store.stage([{ ...candidate("doc"), accessEpoch: 2 }], newer);
    await store.stage([{ ...candidate("doc"), accessEpoch: 1_000_000 }], older);
    expect((await store.pending(["a"], 32))[0]?.accessEpoch).toBe(2);
    const reopened = new DocumentDiscoveryEvidenceRepository(execSql);
    expect(await reopened.begin()).toBeGreaterThan(newer);
  } finally {
    close();
  }
});

test("a local epoch advance refreshes a matching but outdated signed-head cache", async () => {
  const { execSql, close } = await createTestExecSql("discovery-cache-refresh");
  try {
    const store = new DocumentDiscoveryEvidenceRepository(execSql);
    let epoch = 1;
    let calls = 0;
    const verify = createDiscoveredDocumentVerifier(
      "org",
      async () => {
        calls++;
        return {
          ...head,
          accessEpoch: epoch,
          accessStateHash: `head-${epoch}`,
        };
      },
      async () => epoch,
      store,
    );
    await pinTestDiscoveryHead(execSql, "doc", "head-1");
    const input = { ...candidate("doc"), accessStateHash: "head-1" };
    const first = await verify([input], ["a"], await store.begin());
    await first.commit();
    epoch = 2;
    const second = await verify([input], ["a"], await store.begin());
    expect(calls).toBe(2);
    expect(second.inputs[0]?.accessEpoch).toBe(2);
    expect(await second.commit()).toBe(true);
  } finally {
    close();
  }
});

test("unavailable candidates back off across restarts and changed evidence resets attempts", async () => {
  const { execSql, close } = await createTestExecSql(
    "discovery-exponential-backoff",
  );
  try {
    let now = 0;
    let store = new DocumentDiscoveryEvidenceRepository(execSql, () => now);
    const input = candidate("doc");
    await store.stage([input], await store.begin());
    for (let attempt = 1; attempt <= 9; attempt++) {
      await store.defer(input, await store.begin());
      const delay = 15 * 60_000 * 2 ** Math.min(attempt - 1, 7);
      expect(await store.retryDelay(["a"])).toBe(delay);
      store = new DocumentDiscoveryEvidenceRepository(execSql, () => now);
      await store.stage([input], await store.begin());
      expect(await store.retryDelay(["a"])).toBe(delay);
      expect(await store.pending(["a"], 32)).toEqual([]);
      now += delay;
      expect(await store.pending(["a"], 32)).toHaveLength(1);
    }
    const changed = { ...input, accessEpoch: 2, accessStateHash: "new-head" };
    await store.stage([changed], await store.begin());
    expect(await store.retryDelay(["a"])).toBe(0);
    await store.defer(changed, await store.begin());
    expect(await store.retryDelay(["a"])).toBe(15 * 60_000);
  } finally {
    close();
  }
});

test("a coded missing head settles an unapplied listing candidate", async () => {
  const { execSql, close } = await createTestExecSql("discovery-missing-head");
  try {
    const store = new DocumentDiscoveryEvidenceRepository(execSql);
    const verify = createDiscoveredDocumentVerifier(
      "org",
      async () => "not-found",
      async () => 0,
      store,
    );
    const result = await verify(
      [candidate("gone")],
      ["a"],
      await store.begin(),
    );
    expect(result.inputs).toEqual([]);
    expect(await result.commit()).toBe(true);
    expect(await store.hasPending(["a"])).toBe(false);
  } finally {
    close();
  }
});

test("invalid listing epochs cannot poison durable discovery", async () => {
  const { execSql, close } = await createTestExecSql(
    "discovery-invalid-candidate",
  );
  try {
    const store = new DocumentDiscoveryEvidenceRepository(execSql);
    const verify = createDiscoveredDocumentVerifier(
      "org",
      async () => head,
      async () => 0,
      store,
    );
    const result = await verify(
      [
        ...[0, -1, 1.5].map((accessEpoch) => ({
          ...candidate(String(accessEpoch)),
          accessEpoch,
        })),
        candidate("valid"),
      ],
      ["a"],
      await store.begin(),
    );
    expect(result.inputs.map((input) => input.documentId)).toEqual(["valid"]);
    expect(await result.commit()).toBe(true);
  } finally {
    close();
  }
});

test("one signed verification covers multiple listed lanes without resetting backoff", async () => {
  const { execSql, close } = await createTestExecSql(
    "discovery-deduplicated-lanes",
  );
  try {
    const store = new DocumentDiscoveryEvidenceRepository(execSql, () => 0);
    let calls = 0;
    const verify = createDiscoveredDocumentVerifier(
      "org",
      async () => {
        calls++;
        return { ...head, linkedContainerIds: ["a", "b"] };
      },
      async () => 0,
      store,
    );
    const result = await verify(
      [{ ...candidate("doc"), listedContainerIds: ["b", "a"] }],
      ["a", "b"],
      await store.begin(),
    );
    expect(calls).toBe(1);
    expect(result.inputs).toMatchObject([
      { documentId: "doc", containerId: "a" },
    ]);
    expect(await result.commit()).toBe(true);
    await store.stage([candidate("doc")], await store.begin());
    await store.defer(candidate("doc"), await store.begin());
    await store.stage(
      [{ ...candidate("doc"), listedContainerIds: ["a", "b"] }],
      await store.begin(),
    );
    expect(await store.retryDelay(["a"])).toBe(15 * 60_000);
  } finally {
    close();
  }
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
