import { beforeAll, expect, test } from "bun:test";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import {
  createPrincipalHistoryIndexProof,
  type PrincipalHistoryIndexNode,
} from "./principalPolicyHistoryIndex";
import { verifyPrincipalPolicyHistoryReferences } from "./principalPolicyHistoryReferences";
import {
  historyFixture,
  historyHead,
  roundTripHistoryVerifier,
} from "./principalPolicyHistoryTestFixtures";
import { PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT } from "./principalPolicyHistoryTypes";
import { signPolicyState } from "./principalPolicyTestFixtures";

let fixture: Awaited<ReturnType<typeof historyFixture>>;
const signed: Awaited<ReturnType<typeof signPolicyState>>[] = [];
beforeAll(async () => {
  fixture = await historyFixture();
  signed.push(fixture.first, fixture.second, fixture.third);
  for (
    let version = 4;
    version <= PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT + 2;
    version++
  ) {
    const previous = signed.at(-1);
    if (!previous) throw new Error("Missing fixture predecessor");
    signed.push(
      await signPolicyState({
        ...fixture.shared,
        version,
        prevStateHash: previous.state.stateHash,
        signedAt: new Date(Date.UTC(2026, 0, 1) + version * 1000).toISOString(),
      }),
    );
  }
}, 20_000);

test.each([64, PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT + 1])(
  "the full selection budget retains checkpoint %s through authenticated resume",
  async (checkpointVersion) => {
    const checkpointEntry = signed[checkpointVersion - 1];
    const head = signed.at(-1);
    if (!checkpointEntry || !head) throw new Error("Missing fixture head");
    const input = {
      principalId: fixture.shared.principalId,
      principalType: "group" as const,
      localCheckpoint: {
        principalType: "group" as const,
        principalId: fixture.shared.principalId,
        version: checkpointVersion,
        stateHash: checkpointEntry.state.stateHash,
      },
      retainedReferences: signed
        .slice(0, PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT)
        .map(({ state }) => historyHead(state)),
    };
    let verifier = createPrincipalPolicyHistoryVerifier(input);
    const nodes = new Map<string, PrincipalHistoryIndexNode>();
    for (
      let offset = 0;
      offset < signed.length;
      offset += PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT
    ) {
      const appended = await verifier.append({
        entries: signed
          .slice(offset, offset + PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT)
          .map(({ entry }) => entry),
        signerPublicKeys: [fixture.signer],
      });
      if (!appended.ok) throw appended.error;
      for (const node of appended.value.indexNodes) nodes.set(node.hash, node);
      verifier = await roundTripHistoryVerifier(verifier, input);
    }
    const result = verifier.finish(historyHead(head.state));
    if (!result.ok) throw result.error;
    expect(result.value.retainedEntries).toHaveLength(
      PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT +
        1 +
        (checkpointVersion > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT ? 1 : 0),
    );
    expect(
      result.value.retainedEntries.find(
        ({ state }) => state.version === checkpointVersion,
      )?.state,
    ).toEqual(checkpointEntry.state);
    const proofFor = async (entry: (typeof signed)[number]) => ({
      reference: historyHead(entry.state),
      entry: entry.entry,
      proof: await createPrincipalHistoryIndexProof({
        rootHash: result.value.indexRootHash,
        treeSize: head.state.version,
        version: entry.state.version,
        readNode: async (hash) => nodes.get(hash) ?? null,
      }),
    });
    const selected = await verifyPrincipalPolicyHistoryReferences({
      history: result.value,
      references: await Promise.all(
        signed.slice(0, PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT).map(proofFor),
      ),
      checkpointReference: await proofFor(checkpointEntry),
    });
    if (!selected.ok) throw selected.error;
    expect(selected.value.retainedEntries).toEqual(
      result.value.retainedEntries,
    );
  },
);
