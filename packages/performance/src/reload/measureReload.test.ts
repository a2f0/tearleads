import { expect, test } from "bun:test";
import { emptyTraffic, type PostgresTraffic } from "../realtime/postgresWire";
import { measureReloads, type ReloadMeasurement } from "./measureReload";
import type { ReloadOutcome } from "./reloadAccount";

/** An account whose reloads cost one request per folder. */
function fakeAccount(traffic: PostgresTraffic) {
  const calls: string[] = [];
  let documents = 0;
  let folders = 0;
  const localSql = { calls: 0, durationMs: 0 };
  return {
    calls,
    account: {
      folders: () => folders,
      localSql: () => ({ ...localSql }),
      async grow(count: number, perFolder: number) {
        calls.push(`grow ${count} by ${perFolder}`);
        documents = count;
        folders = Math.ceil(count / perFolder);
      },
      async reload(): Promise<ReloadOutcome> {
        calls.push(`reload ${documents}`);
        traffic.statements += 10;
        localSql.calls += 3;
        localSql.durationMs += 1.4;
        return {
          settledMs: 50,
          requests: folders,
          byRoute: [
            { route: "POST /containers/parent-lanes/query", count: folders },
          ],
        };
      },
    },
  };
}

test("each size grows once, then reloads first and then settled", async () => {
  const traffic = emptyTraffic();
  traffic.statements = 100;
  const { account, calls } = fakeAccount(traffic);
  const measured: ReloadMeasurement[] = [];
  const grown: number[] = [];
  await measureReloads({
    account,
    options: { documents: [10, 40], perFolder: 10, samples: 2 },
    traffic: () => ({ ...traffic }),
    grown: (documents) => grown.push(documents),
    measured: async (measurement) => {
      measured.push(measurement);
    },
  });
  expect(calls).toEqual([
    "grow 10 by 10",
    "reload 10",
    "reload 10",
    "reload 10",
    "grow 40 by 10",
    "reload 40",
    "reload 40",
    "reload 40",
  ]);
  expect(grown).toEqual([10, 40]);
  expect(
    measured.map((m) => [m.documents, m.folders, m.reload, m.sample]),
  ).toEqual([
    [10, 1, "first", 1],
    [10, 1, "settled", 1],
    [10, 1, "settled", 2],
    [40, 4, "first", 1],
    [40, 4, "settled", 1],
    [40, 4, "settled", 2],
  ]);
  // Each reload's own database and local work, not the running totals.
  for (const measurement of measured) {
    expect(measurement.database.statements).toBe(10);
    expect(measurement.localSql).toEqual({ calls: 3, durationMs: 1 });
  }
  expect(measured.at(-1)?.requests).toBe(4);
});

test("a failed reload stops the run", async () => {
  const { account } = fakeAccount(emptyTraffic());
  account.reload = async () => {
    throw new Error("The reload did not settle.");
  };
  const measured: ReloadMeasurement[] = [];
  await expect(
    measureReloads({
      account,
      options: { documents: [10], perFolder: 10, samples: 1 },
      traffic: emptyTraffic,
      measured: async (measurement) => {
        measured.push(measurement);
      },
    }),
  ).rejects.toThrow("The reload did not settle.");
  expect(measured).toEqual([]);
});
