import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import {
  createPrincipalPolicyHistoryVerifier,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
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
  "principal verification advances across full pages without retaining the prefix",
  async () => {
    const signer = await createPolicySigner();
    const shared = {
      principalId: "paged-long-history",
      signer,
      principalKeyPair: generateKemSeedAndKeyPair(),
      members: [{ userId: signer.userId }],
    };
    const verifier = createPrincipalPolicyHistoryVerifier({
      principalId: shared.principalId,
      principalType: "group",
    });
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
      const result = verifier.finish(historyHead(next.state));
      if (!result.ok) throw result.error;
      expect(result.value.retainedEntries).toHaveLength(1);
      expect(result.value.currentEntry.state.version).toBe(version);
      page = [];
    }
  },
  boundaryRun ? 600_000 : 30_000,
);
