import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";

const candidate = {
  documentId: "doc",
  containerId: "destination",
  listedContainerIds: ["destination"],
  accessEpoch: 1,
  accessStateHash: "linked-head",
  linkedContainerIds: ["destination"],
  createdAt: "2026-09-23T00:00:00.000Z",
};

test("a lagging same-epoch head retains a link-addition candidate until the head catches up", async () => {
  const { execSql, close } = await createTestExecSql("discovery-head-lag");
  try {
    let now = 0;
    let caughtUp = false;
    const store = createDocumentDiscoveryEvidenceStore(execSql, () => now);
    const verify = createDiscoveredDocumentVerifier(
      async () => ({
        accessEpoch: 1,
        accessStateHash: caughtUp ? "linked-head" : "prior-head",
        linkedContainerIds: caughtUp ? ["source", "destination"] : ["source"],
      }),
      async () => 1,
      store,
    );
    const first = await verify(
      [candidate],
      ["destination"],
      await store.begin(),
    );
    expect(first.inputs).toEqual([]);
    expect(await first.commit()).toBe(false);
    expect(await store.hasPending(["destination"])).toBe(true);
    now = 15 * 60_000;
    caughtUp = true;
    // Resume without another listing item: the lane watermark may have moved.
    const second = await verify([], ["destination"], await store.begin());
    expect(second.inputs).toMatchObject([
      { documentId: "doc", containerId: "destination" },
    ]);
    expect(await second.commit()).toBe(true);
  } finally {
    close();
  }
});

for (const head of [
  {
    accessEpoch: 2,
    accessStateHash: "later-removed-head",
    linkedContainerIds: ["source"],
  },
  {
    accessEpoch: 1,
    accessStateHash: "linked-head",
    linkedContainerIds: ["source"],
  },
  { accessEpoch: Number.MAX_SAFE_INTEGER, linkedContainerIds: [] },
]) {
  test(`matching exclusion or terminal purge settles a candidate (${head.accessEpoch})`, async () => {
    const { execSql, close } = await createTestExecSql(
      "discovery-head-exclusion",
    );
    try {
      const store = createDocumentDiscoveryEvidenceStore(execSql);
      const result = await createDiscoveredDocumentVerifier(
        async () => head,
        async () => 0,
        store,
      )([candidate], ["destination"], await store.begin());
      expect(result.inputs).toEqual([]);
      expect(await result.commit()).toBe(true);
    } finally {
      close();
    }
  });
}
