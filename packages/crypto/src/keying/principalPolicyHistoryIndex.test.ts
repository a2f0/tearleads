import { expect, test } from "bun:test";
import {
  appendPrincipalHistoryIndex,
  createPrincipalHistoryIndexProof,
  normalizePrincipalHistoryIndexFrontier,
  type PrincipalHistoryIndexNode,
  principalHistoryIndexLeaf,
  principalHistoryIndexRoot,
} from "./principalPolicyHistoryIndex";
import { historyFixture } from "./principalPolicyHistoryTestFixtures";
import { assertTransparencyInclusion } from "./transparencyProofs";
import { computeTransparencyMerkleRoot } from "./transparencyTree";

test("incremental principal index agrees with complete trees across unbalanced prefixes", async () => {
  const { first } = await historyFixture();
  const nodes = new Map<string, PrincipalHistoryIndexNode>();
  const leaves: string[] = [];
  let frontier: (string | null)[] = [];
  for (let version = 1; version <= 67; version++) {
    // This differential test exercises index math, not signature verification.
    const state = { ...first.state, version };
    const next = await appendPrincipalHistoryIndex(frontier, [state]);
    frontier = next.frontier;
    leaves.push(await principalHistoryIndexLeaf(state));
    for (const node of next.nodes) nodes.set(node.hash, node);
    expect(next.rootHash).toBe(await computeTransparencyMerkleRoot(leaves));
    expect(await principalHistoryIndexRoot(frontier)).toBe(next.rootHash);
    expect(normalizePrincipalHistoryIndexFrontier(frontier, version)).toEqual(
      frontier,
    );
    if (!next.rootHash) throw new Error("Missing root");
    for (const position of new Set([1, Math.ceil(version / 2), version])) {
      let reads = 0;
      const proof = await createPrincipalHistoryIndexProof({
        rootHash: next.rootHash,
        treeSize: version,
        version: position,
        readNode: async (hash) => {
          reads++;
          return nodes.get(hash) ?? null;
        },
      });
      expect(reads).toBeLessThanOrEqual(Math.ceil(Math.log2(version)));
      const leafHash = leaves[position - 1];
      if (!leafHash) throw new Error("Missing leaf");
      await assertTransparencyInclusion({
        leafHash,
        proof,
        checkpoint: {
          logId: "principal-history",
          treeSize: version,
          rootHash: next.rootHash,
        },
      });
    }
  }
});

test("frontier shape follows exact integer bits beyond 32-bit counters", () => {
  for (const size of [
    0,
    1,
    2,
    3,
    2 ** 32,
    2 ** 32 + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    const frontier: (string | null)[] = [];
    let remaining = size;
    while (remaining) {
      frontier.push(remaining % 2 ? "a".repeat(64) : null);
      remaining = Math.floor(remaining / 2);
    }
    expect(normalizePrincipalHistoryIndexFrontier(frontier, size)).toEqual(
      frontier,
    );
    expect(() =>
      normalizePrincipalHistoryIndexFrontier([...frontier, null], size),
    ).toThrow();
    if (size)
      expect(() => normalizePrincipalHistoryIndexFrontier([], size)).toThrow();
  }
  for (const size of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => normalizePrincipalHistoryIndexFrontier([], size)).toThrow();
  expect(() =>
    normalizePrincipalHistoryIndexFrontier(["invalid"], 1),
  ).toThrow();
});

test("an untrusted index cannot substitute a node or signature", async () => {
  const { first, second, third } = await historyFixture();
  const indexed = await appendPrincipalHistoryIndex(
    [],
    [first.state, second.state, third.state],
  );
  if (!indexed.rootHash) throw new Error("Missing root");
  const nodes = new Map(indexed.nodes.map((node) => [node.hash, node]));
  const input = { rootHash: indexed.rootHash, treeSize: 3, version: 1 };
  await expect(
    createPrincipalHistoryIndexProof({ ...input, readNode: async () => null }),
  ).rejects.toThrow("missing");
  await expect(
    createPrincipalHistoryIndexProof({
      ...input,
      readNode: async (hash) => ({
        hash,
        leftHash: first.state.stateHash,
        rightHash: second.state.stateHash,
      }),
    }),
  ).rejects.toThrow("hash mismatch");
  const proof = await createPrincipalHistoryIndexProof({
    ...input,
    readNode: async (hash) => nodes.get(hash) ?? null,
  });
  const checkpoint = {
    logId: "principal-history",
    treeSize: 3,
    rootHash: indexed.rootHash,
  };
  await assertTransparencyInclusion({
    checkpoint,
    proof,
    leafHash: await principalHistoryIndexLeaf(first.state),
  });
  await expect(
    assertTransparencyInclusion({
      checkpoint,
      proof,
      leafHash: await principalHistoryIndexLeaf({
        ...first.state,
        signature: second.state.signature,
      }),
    }),
  ).rejects.toThrow("root does not match");
});
