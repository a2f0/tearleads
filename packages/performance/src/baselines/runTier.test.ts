import { expect, test } from "bun:test";
import type {
  HttpWireTraffic,
  RequestGate,
} from "../inProcess/httpCounterProxy";
import type { ExportedKeyPackage } from "../inProcess/multiUserDevice";
import { emptyTraffic } from "../inProcess/postgresWire";
import {
  type BaselinePhaseMeasurement,
  type BaselineTierDevice,
  type BaselineTierWorld,
  type HoldBeforeRequest,
  runBaselineTierWithWorld,
} from "./runTier";

interface FakeBaselineOptions {
  readonly staged?: boolean;
  readonly conflictOnRace?: boolean;
  readonly badFreshText?: boolean;
  readonly failBeforeUnlink?: boolean;
  readonly failRacingEdit?: boolean;
}

function createFakeBaselineHarness(options: FakeBaselineOptions = {}) {
  const events: string[] = [];
  const docText = new Map<string, string>();
  let requests = 0;
  let conflicts = 0;
  const byRoute: Record<
    string,
    {
      count: number;
      conflicts: number;
      requestBytes: number;
      responseBytes: number;
    }
  > = {};
  let pendingGate: {
    readonly predicate: (req: { method: string; pathname: string }) => boolean;
    readonly arrived: () => void;
    readonly released: Promise<void>;
    readonly release: () => void;
    cancelled: boolean;
  } | null = null;
  let disposed = false;

  const bumpRoute = (route: string, isConflict = false) => {
    requests += 1;
    if (isConflict) conflicts += 1;
    const prev = byRoute[route] ?? {
      count: 0,
      conflicts: 0,
      requestBytes: 0,
      responseBytes: 0,
    };
    byRoute[route] = {
      count: prev.count + 1,
      conflicts: prev.conflicts + (isConflict ? 1 : 0),
      requestBytes: prev.requestBytes + 100,
      responseBytes: prev.responseBytes + 200,
    };
  };

  const holdBeforeRequest: HoldBeforeRequest = (predicate): RequestGate => {
    let arrived: () => void = () => undefined;
    const waitPromise = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    pendingGate = {
      predicate,
      arrived,
      released,
      release,
      cancelled: false,
    };
    return {
      wait: () => waitPromise,
      release: () => release(),
      cancel: () => {
        if (pendingGate) pendingGate.cancelled = true;
        release();
      },
    };
  };

  const http = (): HttpWireTraffic => ({
    requests,
    conflicts,
    requestBytes: requests * 100,
    responseBytes: requests * 200,
    byRoute: Object.fromEntries(
      Object.entries(byRoute).map(([k, v]) => [k, { ...v }]),
    ),
  });

  const makeDevice = (isFresh = false): BaselineTierDevice => ({
    localSql: () => ({ calls: 4, durationMs: 1.5 }),
    captureSqlWindow: () => ({
      finish: () => ({
        top: [],
        mutations: 2,
        maxMutationHoldMs: 0.4,
        maxStatementsPerMutation: 3,
      }),
    }),
    readDocument: async (documentId) => ({
      getSnapshot: () => ({
        text:
          options.badFreshText && isFresh
            ? "corrupt"
            : (docText.get(documentId) ?? ""),
      }),
    }),
    readDocumentUntilText: async (_documentId, _containers, expectedText) => ({
      getSnapshot: () => ({
        text: options.badFreshText && isFresh ? "corrupt" : expectedText,
      }),
    }),
  });

  const devices = new Map<string, BaselineTierDevice>();
  const world: BaselineTierWorld<BaselineTierDevice> = {
    async register(name) {
      devices.set(name, makeDevice(false));
      return {
        name,
        userId: `u-${name}`,
        keyPackage: {} as ExportedKeyPackage,
        devices: [],
      };
    },
    async newDevice(actor) {
      events.push(`newDevice:${actor.name}`);
      return makeDevice(true);
    },
    rootId: (actor) => `root-${actor.name}`,
    primaryDevice(actor) {
      const device = devices.get(actor.name);
      if (!device) throw new Error(`Missing device for ${actor.name}`);
      return device;
    },
    async addToOrganization() {
      return undefined;
    },
    async createFolder(_actor, _parentId, name) {
      return `folder-${name}`;
    },
    async createDocument(_actor, folderId, text) {
      docText.set("doc-1", text);
      bumpRoute("POST /documents/:documentId/sync");
      return { documentId: "doc-1", containerIds: [folderId] };
    },
    async editDocument(_actor, document, text) {
      if (
        options.failRacingEdit &&
        text.includes("alice wrote while bob rotated")
      ) {
        throw new Error("racing edit boom");
      }
      docText.set(document.documentId, text);
      bumpRoute("POST /documents/:documentId/sync");
      events.push(`edit:${text.slice(-12).trim()}`);
    },
    async shareWithUser() {
      return undefined;
    },
    async linkDocument(_actor, document, folderId) {
      if (!document.containerIds.includes(folderId)) {
        document.containerIds.push(folderId);
      }
      events.push(`link:${folderId}`);
    },
    async unlinkDocument(_actor, document, folderId) {
      if (options.failBeforeUnlink) {
        throw new Error("stage upload boom");
      }
      if (options.staged) {
        bumpRoute("POST /documents/:documentId/baseline-stages");
        bumpRoute(
          "PUT /documents/:documentId/baseline-stages/:stageId/segments/:index",
        );
        bumpRoute(
          "PUT /documents/:documentId/baseline-stages/:stageId/segments/:index",
        );
      }
      const gate = pendingGate;
      if (
        gate &&
        !gate.cancelled &&
        gate.predicate({
          method: "POST",
          pathname: `/documents/${document.documentId}/unlink`,
        })
      ) {
        pendingGate = null;
        gate.arrived();
        await gate.released;
        if (options.conflictOnRace !== false) {
          bumpRoute("POST /documents/:documentId/unlink", true);
          if (options.staged) {
            bumpRoute("GET /documents/:documentId/baseline-stages/:stageId");
            bumpRoute(
              "PUT /documents/:documentId/baseline-stages/:stageId/segments/:index",
            );
          }
        }
      }
      bumpRoute("POST /documents/:documentId/unlink");
      const idx = document.containerIds.indexOf(folderId);
      if (idx >= 0) document.containerIds.splice(idx, 1);
      events.push(`unlink:${folderId}`);
    },
    dispose() {
      disposed = true;
      events.push("dispose");
    },
  };

  return { world, http, holdBeforeRequest, events, isDisposed: () => disposed };
}

test("records inline and staged+race baseline phases with attribution and cleanup", async () => {
  const inline = createFakeBaselineHarness({ staged: false });
  const inlineRows: BaselinePhaseMeasurement[] = [];
  await runBaselineTierWithWorld(inline.world, {
    sizeMiB: 1,
    chunkMiB: 6,
    race: false,
    sample: 1,
    http: inline.http,
    traffic: emptyTraffic,
    holdBeforeRequest: inline.holdBeforeRequest,
    measured: async (m) => {
      inlineRows.push(m);
    },
    generateChunks: () => ["chunkA\n"],
  });
  expect(inline.isDisposed()).toBe(true);
  expect(inlineRows.map((r) => r.phase)).toEqual([
    "seed-history",
    "first-unlink-rotate",
    "fresh-reader-sync",
    "second-unlink-rotate",
  ]);
  expect(inlineRows[1]?.baselineMode).toBe("inline");
  expect(inlineRows[1]?.stagedSegments).toBe(0);
  expect(inlineRows[2]?.localSql?.attribution).toBeDefined();

  const stagedRace = createFakeBaselineHarness({
    staged: true,
    conflictOnRace: true,
  });
  const raceRows: BaselinePhaseMeasurement[] = [];
  await runBaselineTierWithWorld(stagedRace.world, {
    sizeMiB: 13,
    chunkMiB: 6,
    race: true,
    sample: 1,
    http: stagedRace.http,
    traffic: emptyTraffic,
    holdBeforeRequest: stagedRace.holdBeforeRequest,
    measured: async (m) => {
      raceRows.push(m);
    },
    generateChunks: () => ["chunk1\n", "chunk2\n"],
  });
  expect(stagedRace.isDisposed()).toBe(true);
  expect(raceRows[1]?.baselineMode).toBe("staged");
  expect(raceRows[1]?.stagedSegments).toBe(3);
  expect(raceRows[1]?.stageResumes).toBe(1);
  expect(raceRows[1]?.http.conflicts).toBe(1);
});

test("fails cleanly and disposes world on missing 409, early throw, or text mismatch", async () => {
  const noConflict = createFakeBaselineHarness({
    staged: true,
    conflictOnRace: false,
  });
  await expect(
    runBaselineTierWithWorld(noConflict.world, {
      sizeMiB: 13,
      chunkMiB: 6,
      race: true,
      sample: 1,
      http: noConflict.http,
      traffic: emptyTraffic,
      holdBeforeRequest: noConflict.holdBeforeRequest,
      measured: async () => undefined,
      generateChunks: () => ["chunk1\n"],
    }),
  ).rejects.toThrow(/at least one 409/u);
  expect(noConflict.isDisposed()).toBe(true);

  const earlyFail = createFakeBaselineHarness({ failBeforeUnlink: true });
  await expect(
    runBaselineTierWithWorld(earlyFail.world, {
      sizeMiB: 13,
      chunkMiB: 6,
      race: true,
      sample: 1,
      http: earlyFail.http,
      traffic: emptyTraffic,
      holdBeforeRequest: earlyFail.holdBeforeRequest,
      measured: async () => undefined,
      generateChunks: () => ["chunk1\n"],
    }),
  ).rejects.toThrow("stage upload boom");
  expect(earlyFail.isDisposed()).toBe(true);

  const badText = createFakeBaselineHarness({ badFreshText: true });
  await expect(
    runBaselineTierWithWorld(badText.world, {
      sizeMiB: 1,
      chunkMiB: 6,
      race: false,
      sample: 1,
      http: badText.http,
      traffic: emptyTraffic,
      holdBeforeRequest: badText.holdBeforeRequest,
      measured: async () => undefined,
      generateChunks: () => ["chunk1\n"],
    }),
  ).rejects.toThrow(/Fresh reader text mismatch/u);
  expect(badText.isDisposed()).toBe(true);

  const racingEditFail = createFakeBaselineHarness({
    staged: true,
    failRacingEdit: true,
  });
  await expect(
    runBaselineTierWithWorld(racingEditFail.world, {
      sizeMiB: 13,
      chunkMiB: 6,
      race: true,
      sample: 1,
      http: racingEditFail.http,
      traffic: emptyTraffic,
      holdBeforeRequest: racingEditFail.holdBeforeRequest,
      measured: async () => undefined,
      generateChunks: () => ["chunk1\n"],
    }),
  ).rejects.toThrow("racing edit boom");
  expect(racingEditFail.isDisposed()).toBe(true);
  // The held unlink must finish settling before world.dispose() runs.
  expect(
    racingEditFail.events.indexOf("unlink:folder-handoff"),
  ).toBeGreaterThan(-1);
  expect(racingEditFail.events.indexOf("unlink:folder-handoff")).toBeLessThan(
    racingEditFail.events.indexOf("dispose"),
  );
});
