import { expect, test } from "bun:test";
import { createRealtimeGateway } from "@tearleads/api/test-runtime";
import type { InProcessApi } from "../../inProcess/inProcessApi";
import { emptyTraffic } from "../../inProcess/postgresWire";
import type { SeededTree } from "../artifacts";
import {
  type ContentionMeasurement,
  measureContention,
} from "./measureContention";
import { parseContentionOptions } from "./options";

const containerIds = Array.from({ length: 6 }, () => crypto.randomUUID());
const seed: SeededTree = {
  schemaVersion: 1,
  database: "probe",
  userId: "user",
  fanout: 2,
  containerIds,
  seededAt: new Date(0).toISOString(),
  seedMs: 0,
};

function fakeApi(
  authorize: InProcessApi["authorizeContainerAccess"],
): InProcessApi {
  return {
    origin: "http://127.0.0.1",
    authorizeContainerAccess: authorize,
    createRealtimeGateway,
    stop: async () => undefined,
  };
}

const proofs = (ids: readonly string[]) =>
  ids.map((containerId) => ({
    containerId,
    pathContainerIds: [],
    principalKeys: [],
  }));

function options(args: string[]) {
  const parsed = parseContentionOptions(args);
  if (!parsed) throw new Error("Expected options.");
  return parsed;
}

test("sockets declare and revalidate together while hints reach the observer", async () => {
  const requested: number[] = [];
  const measured: ContentionMeasurement[] = [];
  await measureContention({
    api: fakeApi(async (_userId, ids) => {
      requested.push(ids.length);
      // Hold each pass briefly, so hints flow while sockets are busy.
      await Bun.sleep(20);
      return proofs(ids);
    }),
    options: options([
      "--sizes",
      "5",
      "--sockets",
      "1,3",
      "--hint-interval-ms",
      "2",
      "--reuse",
    ]),
    seed,
    traffic: emptyTraffic,
    idleMs: 30,
    measured: async (measurement) => {
      measured.push(measurement);
    },
  });
  expect(
    measured.map(({ pass, size, sockets }) => `${pass} ${sockets}×${size}`),
  ).toEqual([
    "unmarked 1×5",
    "idle 0×0",
    "declaration 1×5",
    "revalidation 1×5",
    "declaration 3×5",
    "revalidation 3×5",
  ]);
  const threeSockets = measured.slice(4);
  for (const measurement of threeSockets) {
    expect(measurement.authorizationMs).toHaveLength(3);
    expect(measurement.hints.sent).toBeGreaterThan(0);
    expect(measurement.hints.delivered).toBe(measurement.hints.sent);
  }
  // Each of the four hubs had an observer that declared the root alone, and
  // every revalidation re-verified it alongside the measured sockets.
  expect(requested.filter((count) => count === 1)).toHaveLength(6);
  expect(requested.filter((count) => count === 5)).toHaveLength(9);
});

test("a socket left short of its folders fails the pass", async () => {
  const run = measureContention({
    api: fakeApi(async (_userId, ids) =>
      proofs(ids.length === 1 ? ids : ids.slice(1)),
    ),
    options: options(["--sizes", "5", "--sockets", "2"]),
    seed,
    traffic: emptyTraffic,
    idleMs: 1,
    measured: async () => undefined,
  });
  // Without --reuse there is no unmarked pass, so the first to fall short is
  // the two sockets' declaration.
  await expect(run).rejects.toThrow(
    /declaration pass did not authorize 5 folders on each of 2 sockets/,
  );
});

test("sizes beyond the seeded tree are refused", async () => {
  const run = measureContention({
    api: fakeApi(async (_userId, ids) => proofs(ids)),
    options: options(["--sizes", "7"]),
    seed,
    traffic: emptyTraffic,
    idleMs: 1,
    measured: async () => undefined,
  });
  await expect(run).rejects.toThrow(/holds only 6 folders/);
});

test("roots mode declares only rootContainerIds even for a larger tree size", async () => {
  const requested: number[] = [];
  const measured: ContentionMeasurement[] = [];
  await measureContention({
    api: fakeApi(async (_userId, ids) => {
      requested.push(ids.length);
      return proofs(ids);
    }),
    options: options([
      "--sizes",
      "5",
      "--sockets",
      "2",
      "--mode",
      "roots",
      "--hint-interval-ms",
      "2",
    ]),
    seed: { ...seed, rootContainerIds: containerIds.slice(0, 1) },
    traffic: emptyTraffic,
    idleMs: 10,
    measured: async (measurement) => {
      measured.push(measurement);
    },
  });
  expect(
    measured.map(({ pass, size, sockets }) => `${pass} ${sockets}×${size}`),
  ).toEqual(["idle 0×0", "declaration 2×5", "revalidation 2×5"]);
  expect(measured[1]?.authorizationMs).toHaveLength(2);
  expect(measured[2]?.authorizationMs).toHaveLength(2);
  // Every authorization call was for 1 root, never all 5 folders.
  expect(requested.every((count) => count === 1)).toBe(true);
});
