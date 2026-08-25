import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@symcrypt/loro";
import { isDocumentUpdateDominatedByBaseline } from "./documentBaselineDominance";
import { selectServedSyncUpdates } from "./documentSyncBaselineRedirect";

const COUNTERS = [0, 1, 2] as const;
const EPOCHS = [1, 2, 3] as const;

interface BoundedVector {
  readonly counters: readonly [number, number];
  readonly encoded: string;
}

interface TraceEntry {
  readonly id: string;
  readonly update: { readonly partialEndVersionVector: string };
  readonly writeHeader: { readonly contentKeyEpoch: number };
}

async function buildPeerPrefixes(
  seed: string,
): Promise<Array<Uint8Array | null>> {
  const document = await createDocument(seed);
  const prefixes: Array<Uint8Array | null> = [null];

  for (const counter of COUNTERS.slice(1)) {
    document.getText("text").insert(counter - 1, String(counter));
    document.commit();
    prefixes.push(exportAllUpdates(document));
  }

  return prefixes;
}

async function buildBoundedVectors(): Promise<BoundedVector[]> {
  const firstPeer = await buildPeerPrefixes("dominance-model-peer-a");
  const secondPeer = await buildPeerPrefixes("dominance-model-peer-b");
  const vectors: BoundedVector[] = [];

  for (const firstCounter of COUNTERS) {
    for (const secondCounter of COUNTERS) {
      const document = await createDocument(
        `dominance-model-${firstCounter}-${secondCounter}`,
      );
      const updates = [
        firstPeer[firstCounter],
        secondPeer[secondCounter],
      ].filter((update): update is Uint8Array => update !== null);
      importUpdates(document, updates);
      vectors.push({
        counters: [firstCounter, secondCounter],
        encoded: encodeVersionVector(document),
      });
    }
  }

  return vectors;
}

function abstractlyDominates(
  baseline: BoundedVector,
  update: BoundedVector,
): boolean {
  return baseline.counters.every(
    (counter, index) => counter >= (update.counters[index] ?? 0),
  );
}

function entry(
  id: string,
  contentKeyEpoch: number,
  vector: BoundedVector,
): TraceEntry {
  return {
    id,
    update: { partialEndVersionVector: vector.encoded },
    writeHeader: { contentKeyEpoch },
  };
}

function ids(entries: readonly TraceEntry[]): string[] {
  return entries.map((item) => item.id);
}

test("bounded vectors conform to componentwise baseline dominance", async () => {
  const vectors = await buildBoundedVectors();
  let checkedCases = 0;

  for (const baselineEpoch of EPOCHS) {
    for (const updateEpoch of EPOCHS) {
      for (const baseline of vectors) {
        for (const update of vectors) {
          const expected =
            updateEpoch < baselineEpoch &&
            abstractlyDominates(baseline, update);
          expect(
            isDocumentUpdateDominatedByBaseline({
              baselineEpoch,
              baselineVersionVector: baseline.encoded,
              updateEpoch,
              updateVersionVector: update.encoded,
            }),
          ).toBe(expected);
          checkedCases += 1;
        }
      }
    }
  }

  expect(checkedCases).toBe(729);
});

test("bounded redirect traces retain every uncovered update", async () => {
  const vectors = await buildBoundedVectors();
  let checkedTraces = 0;

  for (const currentEpoch of EPOCHS) {
    for (const firstEpoch of EPOCHS) {
      for (const secondEpoch of EPOCHS) {
        for (const firstVector of vectors) {
          for (const secondVector of vectors) {
            for (const baseline of vectors) {
              const firstEntry = entry("first", firstEpoch, firstVector);
              const secondEntry = entry("second", secondEpoch, secondVector);
              const baselineEntry = entry("baseline", currentEpoch, baseline);
              const candidateOrders = [
                [firstEntry, secondEntry],
                [secondEntry, firstEntry],
              ] as const;

              for (const candidates of candidateOrders) {
                const missing = [candidates[0], baselineEntry, candidates[1]];
                const dominatedIds = candidates
                  .filter(
                    (candidate) =>
                      candidate.writeHeader.contentKeyEpoch < currentEpoch &&
                      abstractlyDominates(
                        baseline,
                        candidate.id === "first" ? firstVector : secondVector,
                      ),
                  )
                  .map((candidate) => candidate.id);
                const olderCandidates = candidates.filter(
                  (candidate) =>
                    candidate.writeHeader.contentKeyEpoch < currentEpoch,
                );
                const canRedirect =
                  olderCandidates.length > 0 &&
                  olderCandidates.every((candidate) =>
                    dominatedIds.includes(candidate.id),
                  );
                const expectedServed = canRedirect
                  ? missing.filter(
                      (candidate) =>
                        candidate.writeHeader.contentKeyEpoch >= currentEpoch,
                    )
                  : missing;

                const served = selectServedSyncUpdates({
                  baselineCoverage: baseline.encoded,
                  currentContentKeyEpoch: currentEpoch,
                  entries: missing,
                });
                expect(ids(served)).toEqual(ids(expectedServed));

                const rawServed = selectServedSyncUpdates({
                  baselineCoverage: baseline.encoded,
                  currentContentKeyEpoch: currentEpoch,
                  entries: missing,
                  historyMode: "raw",
                });
                expect(ids(rawServed)).toEqual(ids(missing));

                const servedIds = new Set(ids(served));
                const unavailableIds = ids(missing).filter(
                  (id) => !servedIds.has(id),
                );
                expect(
                  unavailableIds.every((id) => dominatedIds.includes(id)),
                ).toBe(true);
                checkedTraces += 1;
              }
            }
          }
        }
      }
    }
  }

  expect(checkedTraces).toBe(39_366);
});

test("bounded missing-baseline cases fail closed", async () => {
  const vectors = await buildBoundedVectors();
  let checkedCases = 0;

  for (const currentEpoch of EPOCHS) {
    for (const firstEpoch of EPOCHS) {
      for (const secondEpoch of EPOCHS) {
        for (const firstVector of vectors) {
          for (const secondVector of vectors) {
            const firstEntry = entry("first", firstEpoch, firstVector);
            const secondEntry = entry("second", secondEpoch, secondVector);

            for (const missing of [
              [firstEntry, secondEntry],
              [secondEntry, firstEntry],
            ] as const) {
              expect(
                ids(
                  selectServedSyncUpdates({
                    baselineCoverage: null,
                    currentContentKeyEpoch: currentEpoch,
                    entries: missing,
                  }),
                ),
              ).toEqual(ids(missing));
              checkedCases += 1;
            }
          }
        }
      }
    }
  }

  expect(checkedCases).toBe(4_374);
});
