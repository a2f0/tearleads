// Completeness: every honest holder of one history computes one identity and
// accepts every honest update of it, whatever path brought the history:
// separate uploads, one batch, a snapshot, a snapshot and updates, uploads
// and then a snapshot, or segments cut at arbitrary counters. The histories
// are generated from a seed and span several of Loro's storage blocks.
import { expect, test } from "bun:test";
import {
  encodeVersionVector,
  exportFullHistoryIdentity,
  versionVectorsEqual,
} from "./document";
import {
  generateHeldHistory,
  type HeldHistoryOptions,
} from "./historyHolders.testFixtures";
import { updateMatchesDocumentHistory } from "./updateIdentity";

const SIZES = [1, 5, 17, 60, 300, 900, 2200, 4200, 6000];

async function expectOneIdentity(seed: number, options: HeldHistoryOptions) {
  const held = await generateHeldHistory(seed, options);
  try {
    const [source] = held.holders.values();
    if (!source) throw new Error("No holder");
    const identity = exportFullHistoryIdentity(source);
    for (const [name, holder] of held.holders) {
      expect([
        name,
        versionVectorsEqual(
          encodeVersionVector(holder),
          encodeVersionVector(source),
        ),
      ]).toEqual([name, true]);
      expect([name, exportFullHistoryIdentity(holder) === identity]).toEqual([
        name,
        true,
      ]);
    }
    for (const [name, holder] of held.holders) {
      const refused = held.updates
        .filter(({ update }) => !updateMatchesDocumentHistory(holder, update))
        .map((update) => `${update.name} on ${name}`);
      expect(refused).toEqual([]);
    }
  } finally {
    held.free();
  }
}

// What documents hold today: text, lists, maps and their nested containers.
test.each([1, 2, 3, 4, 5, 6, 7, 8])(
  "every holder of a generated history has one identity (seed %d)",
  (seed) =>
    expectOneIdentity(seed, {
      kinds: "app",
      rounds: 12,
      sizes: SIZES,
      writers: seed % 3 === 0 ? 3 : 2,
    }),
);

// And the kinds no document holds yet: marks, movable lists, trees, counters.
test.each([11, 12, 13, 14])(
  "every holder of a history of every kind has one identity (seed %d)",
  (seed) =>
    expectOneIdentity(seed, {
      kinds: "all",
      rounds: 14,
      sizes: SIZES,
      writers: seed % 2 === 0 ? 3 : 2,
    }),
);
