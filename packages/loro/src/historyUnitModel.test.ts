// The canonical form depends on a history's units and on nothing else. The
// fixtures state the unit model apart from the production encoder: these
// tests check the model against Loro, then that every grouping of one unit
// sequence has one canonical form and that the form says what the units are.
import { expect, test } from "bun:test";
import { type JsonSchema, LoroDoc } from "loro-crdt";
import {
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  importSnapshot,
  versionVectorsEqual,
} from "./document";
import { serializeCanonicalHistory } from "./historyCanonicalization";
import { generateHeldHistory, generator } from "./historyHolders.testFixtures";
import {
  explodeHistory,
  regroupHistory,
  unitsOf,
  unitsOfCanonicalForm,
} from "./historyUnits.testFixtures";

function historyOf(doc: LoroDoc): JsonSchema {
  return doc.exportJsonUpdates(undefined, undefined, false);
}

/** A history of every kind of operation, small enough to take apart. */
function generated(seed: number) {
  return generateHeldHistory(seed, {
    kinds: "all",
    rounds: 12,
    sizes: [1, 5, 17, 60, 300],
    writers: seed % 2 === 0 ? 3 : 2,
  });
}

const SEEDS = [21, 22, 23, 24, 25, 26];

test.each(SEEDS)(
  "Loro reads a history taken apart into units as the same history (seed %d)",
  async (seed) => {
    const held = await generated(seed);
    const [source] = held.holders.values();
    if (!source) throw new Error("No holder");
    const next = generator(seed);
    const history = historyOf(source);

    for (const variant of [
      explodeHistory(history),
      explodeHistory(history, { operations: false }),
      regroupHistory(history, next),
    ]) {
      const doc = new LoroDoc();
      doc.importJsonUpdates(variant);
      expect(
        versionVectorsEqual(
          encodeVersionVector(doc),
          encodeVersionVector(source),
        ),
      ).toBe(true);
      expect(doc.toJSON()).toEqual(source.toJSON());
      expect(exportFullHistoryIdentity(doc)).toBe(
        exportFullHistoryIdentity(source),
      );
      // However Loro regroups them in a snapshot, they are the same units:
      // a wrong unit, such as a backward run read in forward order, is not.
      const again = new LoroDoc();
      importSnapshot(again, exportFullHistorySnapshot(doc));
      expect(unitsOf(historyOf(again))).toEqual(unitsOf(history));
      doc.free();
      again.free();
    }
    held.free();
  },
);

test.each(SEEDS)(
  "every grouping of a history's units has one canonical form (seed %d)",
  async (seed) => {
    const held = await generated(seed);
    const next = generator(seed + 1);
    const [source] = held.holders.values();
    if (!source) throw new Error("No holder");
    const canonical = serializeCanonicalHistory(historyOf(source));

    for (const holder of held.holders.values()) {
      const history = historyOf(holder);
      expect(serializeCanonicalHistory(history)).toBe(canonical);
      expect(serializeCanonicalHistory(explodeHistory(history))).toBe(
        canonical,
      );
      expect(serializeCanonicalHistory(regroupHistory(history, next))).toBe(
        canonical,
      );
    }
    held.free();
  },
);

test.each(SEEDS)(
  "the canonical form says exactly what a history's units are (seed %d)",
  async (seed) => {
    const held = await generated(seed);
    for (const holder of held.holders.values()) {
      const history = historyOf(holder);

      expect(unitsOfCanonicalForm(serializeCanonicalHistory(history))).toEqual(
        unitsOf(history),
      );
    }
    held.free();
  },
);
