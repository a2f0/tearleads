import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import {
  createPrincipalHistoryIndexProof,
  type PrincipalHistoryIndexNode,
} from "./principalPolicyHistoryIndex";
import {
  historyFixture,
  historyHead,
  roundTripHistoryVerifier,
} from "./principalPolicyHistoryTestFixtures";
import type { PrincipalPolicyStateChainEntry } from "./types";

export async function indexedHistoryFixture() {
  const fixture = await historyFixture();
  const scope = {
    principalId: fixture.shared.principalId,
    principalType: "group" as const,
  };
  const nodes = new Map<string, PrincipalHistoryIndexNode>();
  let verifier = createPrincipalPolicyHistoryVerifier(scope);
  for (const entry of [
    fixture.first.entry,
    fixture.second.entry,
    fixture.third.entry,
  ]) {
    const result = await verifier.append({
      entries: [entry],
      signerPublicKeys: [fixture.signer],
    });
    if (!result.ok) throw result.error;
    for (const node of result.value.indexNodes) nodes.set(node.hash, node);
    // Restart between every page; proof roots must survive independently of
    // the untrusted proof-node store and requested reference selection.
    verifier = await roundTripHistoryVerifier(verifier, scope);
  }
  const finished = verifier.finish(historyHead(fixture.third.state));
  if (!finished.ok) throw finished.error;
  const history = finished.value;
  const reference = async (entry: PrincipalPolicyStateChainEntry) => ({
    reference: historyHead(entry.state),
    entry,
    proof: await createPrincipalHistoryIndexProof({
      rootHash: history.indexRootHash,
      treeSize: history.currentEntry.state.version,
      version: entry.state.version,
      readNode: async (hash) => nodes.get(hash) ?? null,
    }),
  });
  return { ...fixture, nodes, verifier, history, reference };
}
