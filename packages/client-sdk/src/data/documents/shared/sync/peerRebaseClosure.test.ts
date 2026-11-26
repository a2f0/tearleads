import { describe, expect, it } from "bun:test";
import {
  PeerRebaseCommittedCutError,
  type PeerRebaseInput,
  rebaseOntoFreshPeer,
} from "./peerRebase";
import {
  canonicalContent,
  documentOnPeer,
  type TestDocument,
  versionCounters,
} from "./peerRebase.testFixtures";

const RECORD_PEER = "11";
const OLDER_OWN_PEER = "12";
const FORGER_PEER = "21";
const NEW_PEER = "99";

function writeAs(doc: TestDocument, peer: string, text: string): void {
  doc.commit();
  doc.setPeerId(BigInt(peer));
  const content = doc.getText("text");
  content.insert(content.length, text);
  doc.commit();
}

/** A committed "base" (record peer 0..4) and one unsent op on it (5). */
async function deviceWithUnsentRecordOp(): Promise<TestDocument> {
  const device = await documentOnPeer(Number(RECORD_PEER));
  writeAs(device, RECORD_PEER, "base ");
  writeAs(device, RECORD_PEER, "X");
  return device;
}

/** In these histories the server committed everything below the queue's start. */
function rebaseUnrelayed(input: Omit<PeerRebaseInput, "committedVersion">) {
  return rebaseOntoFreshPeer({ ...input, committedVersion: input.unsentStart });
}

describe("rebaseOntoFreshPeer cut closure", () => {
  it("cuts an unsent own op on another peer that depends on a cut op", async () => {
    const device = await deviceWithUnsentRecordOp();
    writeAs(device, OLDER_OWN_PEER, "Y");
    const content = canonicalContent(device);

    const result = rebaseUnrelayed({
      live: device,
      newPeer: NEW_PEER,
      refusedFrontiers: new Map([[RECORD_PEER, 5]]),
      unsentStart: new Map([
        [RECORD_PEER, 5],
        [OLDER_OWN_PEER, 0],
      ]),
    });

    if (result.kind !== "rebased") throw new Error("expected a rebase");
    expect(Object.fromEntries(result.keptVersion)).toEqual({
      [OLDER_OWN_PEER]: 0,
      [RECORD_PEER]: 5,
    });
    expect(canonicalContent(result.fork)).toBe(content);
    expect(Object.fromEntries(versionCounters(result.fork))).toEqual({
      [NEW_PEER]: 2,
      [RECORD_PEER]: 5,
    });
    result.fork.free();
  });

  it("keeps a peer the server did not name whole", async () => {
    const device = await documentOnPeer(Number(RECORD_PEER));
    writeAs(device, RECORD_PEER, "base ");
    writeAs(device, OLDER_OWN_PEER, "Y");
    writeAs(device, RECORD_PEER, "X");

    const result = rebaseUnrelayed({
      live: device,
      newPeer: NEW_PEER,
      refusedFrontiers: new Map([[RECORD_PEER, 5]]),
      unsentStart: new Map([
        [RECORD_PEER, 5],
        [OLDER_OWN_PEER, 0],
      ]),
    });

    if (result.kind !== "rebased") throw new Error("expected a rebase");
    expect(versionCounters(result.fork).get(OLDER_OWN_PEER)).toBe(1);
    // A later refusal naming that peer rebases it in turn.
    expect(Object.fromEntries(result.unsentBase)).toEqual({
      [OLDER_OWN_PEER]: 0,
      [RECORD_PEER]: 5,
    });
    result.fork.free();
  });

  it("refuses to cut an own op this device knows is committed", async () => {
    const device = await deviceWithUnsentRecordOp();
    writeAs(device, OLDER_OWN_PEER, "Y");

    expect(() =>
      rebaseUnrelayed({
        live: device,
        newPeer: NEW_PEER,
        refusedFrontiers: new Map([[RECORD_PEER, 5]]),
        unsentStart: new Map([
          [RECORD_PEER, 5],
          [OLDER_OWN_PEER, 1],
        ]),
      }),
    ).toThrow(PeerRebaseCommittedCutError);
  });

  it("refuses to cut a committed foreign op that depends on a cut op", async () => {
    const device = await deviceWithUnsentRecordOp();
    // Before the server checks dependencies, a forger can commit an op that
    // depends on the device's next op; the device imports it as committed.
    const forger = await documentOnPeer(Number(FORGER_PEER));
    forger.import(device.export({ mode: "update" }));
    writeAs(forger, FORGER_PEER, "Z");
    device.import(forger.export({ mode: "update" }));
    const live = versionCounters(device);

    let thrown: unknown;
    try {
      rebaseUnrelayed({
        live: device,
        newPeer: NEW_PEER,
        refusedFrontiers: new Map([[RECORD_PEER, 5]]),
        unsentStart: new Map([
          [RECORD_PEER, 5],
          [FORGER_PEER, live.get(FORGER_PEER) ?? 0],
        ]),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PeerRebaseCommittedCutError);
    expect((thrown as PeerRebaseCommittedCutError).peerId).toBe(FORGER_PEER);
  });

  it("reports nothing to cut when no refused peer passes its frontier", async () => {
    const device = await deviceWithUnsentRecordOp();

    const result = rebaseUnrelayed({
      live: device,
      newPeer: NEW_PEER,
      refusedFrontiers: new Map([[RECORD_PEER, 6]]),
      unsentStart: new Map([[RECORD_PEER, 5]]),
    });

    expect(result).toEqual({ kind: "nothing_to_cut" });
  });
});
