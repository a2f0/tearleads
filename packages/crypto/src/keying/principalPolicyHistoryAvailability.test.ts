import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import {
  createPrincipalHistoryIndexProof,
  createPrincipalPolicyHistoryVerifier,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  restorePrincipalPolicyHistoryVerifier,
  verifyPrincipalPolicyHistoryReferences,
} from "../index";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { PrincipalPolicyStateChainEntry } from "./types";

const { PRINCIPAL_HISTORY_BOUNDARY_TEST } = process.env;
const boundaryRun = PRINCIPAL_HISTORY_BOUNDARY_TEST === "1";

test(
  "principal verification resumes across full pages without retaining the prefix",
  async () => {
    const signer = await createPolicySigner();
    const shared = {
      principalId: "paged-long-history",
      signer,
      principalKeyPair: generateKemSeedAndKeyPair(),
      members: [{ userId: signer.userId }],
    };
    const input = {
      principalId: shared.principalId,
      principalType: "group" as const,
    };
    const protection = {
      localKey: crypto.getRandomValues(new Uint8Array(32)),
      context: "long-history-recovery",
    };
    let verifier = createPrincipalPolicyHistoryVerifier(input);
    let initialProgressSize: number | undefined;
    const lastVersion = boundaryRun
      ? 16_385
      : PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT * 2 + 1;
    let prevStateHash: string | null = null;
    let page: PrincipalPolicyStateChainEntry[] = [];
    for (let version = 1; version <= lastVersion; version++) {
      const next = await signPolicyState({
        ...shared,
        version,
        prevStateHash,
        signedAt: new Date(Date.UTC(2026, 0, 1) + version * 1000).toISOString(),
      });
      prevStateHash = next.state.stateHash;
      page.push(next.entry);
      if (
        page.length < PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT &&
        version !== lastVersion
      )
        continue;
      const append = await verifier.append({
        entries: page,
        signerPublicKeys: [signer],
      });
      if (!append.ok) throw append.error;
      expect(append.value.throughVersion).toBe(version);
      expect(append.value.indexNodes.length).toBeLessThanOrEqual(
        page.length + 106,
      );
      const saved = await verifier.exportProgress(protection);
      if (!saved.ok) throw saved.error;
      initialProgressSize ??= saved.value.length;
      // The index adds at most one 64-byte hash (plus JSON/base64 framing)
      // per tree level; it must not retain the history itself.
      const frontierBytes = (Math.floor(Math.log2(version)) + 1) * 67;
      expect(saved.value.length).toBeLessThanOrEqual(
        initialProgressSize + Math.ceil(frontierBytes / 3) * 4 + 256,
      );
      const restored = await restorePrincipalPolicyHistoryVerifier(
        input,
        saved.value,
        protection,
      );
      if (!restored.ok) throw restored.error;
      verifier = restored.value;
      const result = verifier.finish(historyHead(next.state));
      if (!result.ok) throw result.error;
      expect(result.value.retainedEntries).toHaveLength(1);
      expect(result.value.currentEntry.state.version).toBe(version);
      const nodes = new Map(
        append.value.indexNodes.map((node) => [node.hash, node]),
      );
      const proof = await createPrincipalHistoryIndexProof({
        rootHash: result.value.indexRootHash,
        treeSize: version,
        version,
        readNode: async (hash) => nodes.get(hash) ?? null,
      });
      const selected = await verifyPrincipalPolicyHistoryReferences({
        history: result.value,
        references: [
          { reference: historyHead(next.state), entry: next.entry, proof },
        ],
      });
      expect(selected.ok).toBe(true);
      page = [];
    }
  },
  boundaryRun ? 600_000 : 30_000,
);
