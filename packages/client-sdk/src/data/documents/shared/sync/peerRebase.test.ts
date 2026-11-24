import { describe, expect, it } from "bun:test";
import {
  decodeVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { rebaseOntoFreshPeer } from "./peerRebase";
import {
  canonicalContent,
  closeUpward,
  covers,
  documentOnPeer,
  isCausallyClosed,
  randomEdits,
  seededRandom,
  type TestDocument,
  versionCounters,
} from "./peerRebase.testFixtures";

const RECORD_PEER = 11;
const OLDER_OWN_PEER = 12;
const FOREIGN_PEER = 21;
const NEW_PEER = 99;

function exchange(left: TestDocument, right: TestDocument): void {
  left.import(right.export({ mode: "update" }));
  right.import(left.export({ mode: "update" }));
}

function switchPeer(doc: TestDocument, peer: number): void {
  doc.commit();
  doc.setPeerId(BigInt(peer));
}

interface Scenario {
  /** What the server holds: closed, and F on every refused peer. */
  readonly committed: Map<string, number>;
  readonly device: TestDocument;
  readonly foreign: TestDocument;
  readonly refused: Map<string, number>;
  /** What the device knows is committed: its sent history. */
  readonly unsentStart: Map<string, number>;
}

/**
 * A device writing on two of its own peers and a foreign writer share a
 * committed history. The device then edits offline while importing the
 * foreign writer's committed edits. The server holds the device's offline
 * ops on some of its peers up to a random point (as a republish of history
 * would), closed under dependencies, and refuses the device past it.
 */
async function buildScenario(seed: number): Promise<Scenario> {
  const random = seededRandom(seed);
  const device = await documentOnPeer(RECORD_PEER);
  const foreign = await documentOnPeer(FOREIGN_PEER);
  for (let round = 0; round < 6; round += 1) {
    const actor = random();
    if (actor < 0.4) randomEdits(foreign, random);
    else {
      switchPeer(device, actor < 0.7 ? RECORD_PEER : OLDER_OWN_PEER);
      randomEdits(device, random);
    }
    exchange(device, foreign);
  }
  const unsentStart = versionCounters(device);
  for (let round = 0; round < 8; round += 1) {
    const actor = random();
    if (actor < 0.3) {
      const before = device.oplogVersion();
      randomEdits(foreign, random);
      device.import(foreign.export({ from: before, mode: "update" }));
    } else {
      switchPeer(device, actor < 0.75 ? RECORD_PEER : OLDER_OWN_PEER);
      randomEdits(device, random);
    }
  }
  device.commit();
  const live = versionCounters(device);
  const committed = new Map(unsentStart);
  committed.set(String(FOREIGN_PEER), live.get(String(FOREIGN_PEER)) ?? 0);
  const refusedPeers: string[] = [];
  for (const peer of [String(RECORD_PEER), String(OLDER_OWN_PEER)]) {
    const start = unsentStart.get(peer) ?? 0;
    const end = live.get(peer) ?? 0;
    if (end > start && random() < 0.7) {
      committed.set(peer, start + Math.floor(random() * (end - start)));
      refusedPeers.push(peer);
    }
  }
  closeUpward(device, committed);
  const refused = new Map<string, number>();
  for (const peer of refusedPeers) {
    const frontier = committed.get(peer) ?? 0;
    if (frontier < (live.get(peer) ?? 0)) refused.set(peer, frontier);
  }
  return { committed, device, foreign, refused, unsentStart };
}

function versionFromCounters(version: ReadonlyMap<string, number>) {
  return decodeVersionVector(
    encodeVersionVectorCounters(Object.fromEntries(version)),
  );
}

function importAll(target: TestDocument, update: Uint8Array): void {
  const status = target.import(update);
  expect(status.pending == null || status.pending.size === 0).toBe(true);
}

describe("rebaseOntoFreshPeer over random histories", () => {
  it("keeps the content, leaves refused peers at F, and converges", async () => {
    let rebased = 0;
    let closureCuts = 0;
    for (let seed = 1; seed <= 80; seed += 1) {
      const scenario = await buildScenario(seed);
      if (scenario.refused.size === 0) continue;
      const liveContent = canonicalContent(scenario.device);
      const result = rebaseOntoFreshPeer({
        live: scenario.device,
        newPeer: `${NEW_PEER}`,
        refusedFrontiers: scenario.refused,
        unsentStart: scenario.unsentStart,
      });
      if (result.kind !== "rebased") {
        throw new Error(`seed ${seed}: a refused peer past F cut nothing`);
      }
      rebased += 1;
      const live = versionCounters(scenario.device);
      const forkVersion = versionCounters(result.fork);
      if (
        [...live].some(
          ([peer, end]) =>
            (result.keptVersion.get(peer) ?? 0) <
            Math.min(end, scenario.refused.get(peer) ?? end),
        )
      ) {
        closureCuts += 1;
      }
      expect(canonicalContent(result.fork)).toBe(liveContent);
      for (const [peer, frontier] of scenario.refused) {
        expect(forkVersion.get(peer) ?? 0).toBeLessThanOrEqual(frontier);
      }
      expect(isCausallyClosed(scenario.device, result.keptVersion)).toBe(true);
      expect(covers(result.keptVersion, scenario.committed)).toBe(true);
      for (const [peer, counter] of result.keptVersion) {
        expect(forkVersion.get(peer) ?? 0).toBe(counter);
      }
      // The update starts inside what the server and the foreign writer hold.
      expect(covers(scenario.committed, result.unsentBase)).toBe(true);
      expect(covers(versionCounters(scenario.foreign), result.unsentBase)).toBe(
        true,
      );

      const server = scenario.device.forkAt(
        scenario.device.vvToFrontiers(versionFromCounters(scenario.committed)),
      );
      importAll(server, result.update);
      expect(canonicalContent(server)).toBe(liveContent);
      importAll(scenario.foreign, result.update);
      expect(canonicalContent(scenario.foreign)).toBe(liveContent);
      for (const doc of [server, result.fork, scenario.foreign]) doc.free();
      scenario.device.free();
    }
    expect(rebased).toBeGreaterThan(40);
    // Some histories put an own op on the other peer after a cut op.
    expect(closureCuts).toBeGreaterThan(5);
  });
});
