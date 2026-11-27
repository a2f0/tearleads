import { expect, test } from "bun:test";
import { emptyHttpTraffic } from "../inProcess/httpCounterProxy";
import { emptyTraffic } from "../inProcess/postgresWire";
import { measureBaselines } from "./measureBaselines";

test("executes every configured size and sample tier in order", async () => {
  const seen: string[] = [];
  await measureBaselines({
    apiBaseUrl: "http://127.0.0.1:4001",
    trustOrigin: "http://127.0.0.1:4000",
    options: { sizesMb: [1, 13], chunkMb: 6, samples: 2, race: true },
    http: emptyHttpTraffic,
    traffic: emptyTraffic,
    holdBeforeRequest: () => ({
      wait: async () => undefined,
      release: () => undefined,
      cancel: () => undefined,
    }),
    measured: async () => undefined,
    runTier: async (input) => {
      seen.push(
        `S=${input.sizeMiB} C=${input.chunkMiB} R=${input.race} #${input.sample}`,
      );
    },
  });
  expect(seen).toEqual([
    "S=1 C=6 R=true #1",
    "S=1 C=6 R=true #2",
    "S=13 C=6 R=true #1",
    "S=13 C=6 R=true #2",
  ]);
});
