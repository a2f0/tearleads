import { describe, expect, it } from "bun:test";
import {
  encodeVersionVector,
  encodeVersionVectorCounters,
  exportAllUpdates,
  getImportBlobMetadata,
  listVersionVectorSpans,
  versionVectorsEqual,
} from "@tearleads/loro";
import { documentOnPeer, versionCounters } from "./peerRebase.testFixtures";
import {
  type PeerRefusalKind,
  type PeerRefusalRecovery,
  planPeerRefusalRecovery,
} from "./peerRefusalRecovery";
import {
  alternatingHistory,
  append,
  MEMBER,
  MEMBER_PEER,
  OWNER,
  OWNER_DEVICE_PEER,
  PeerServer,
  partlySeenHistory,
  pull,
  QueueDevice,
  STALE_PEER,
  textOf,
} from "./peerRefusalRecovery.testFixtures";

const NEW_PEER = "99";

/** "hello " committed on the record peer, then "world" queued unsent. */
async function deviceWithQueuedEdit() {
  const live = await documentOnPeer(Number(MEMBER_PEER));
  append(live, "hello ");
  const committed = encodeVersionVector(live);
  append(live, "world");
  return {
    committed,
    live,
    queued: {
      partialEndVersionVector: encodeVersionVector(live),
      partialStartVersionVector: committed,
    },
  };
}

function spansOf(update: Uint8Array) {
  return listVersionVectorSpans(getImportBlobMetadata(update));
}

describe("planPeerRefusalRecovery", () => {
  const cases: readonly {
    readonly expected: PeerRefusalRecovery["kind"];
    readonly frontier: number;
    readonly name: string;
    readonly refusal: PeerRefusalKind;
  }[] = [
    {
      expected: "relay",
      frontier: 0,
      name: "relays a lost dependency from the named frontier",
      refusal: "dependency_uncommitted",
    },
    {
      expected: "park",
      frontier: 2,
      name: "parks when another user owns the peer whose history fell",
      refusal: "peer_owned",
    },
    {
      expected: "rebase",
      frontier: 6,
      name: "rebases unsent operations at the committed frontier",
      refusal: "peer_owned",
    },
    {
      expected: "rebase",
      frontier: 6,
      name: "rebases a dependency on its own unsent operation",
      refusal: "dependency_uncommitted",
    },
    {
      expected: "nothing_to_cut",
      frontier: 11,
      name: "cuts nothing below a frontier that covers the document",
      refusal: "peer_owned",
    },
  ];

  it.each(cases)("$name", async ({ expected, frontier, refusal }) => {
    const { committed, live, queued } = await deviceWithQueuedEdit();
    const recovery = planPeerRefusalRecovery({
      committedVersion: committed,
      live,
      newPeer: NEW_PEER,
      pendingBases: [encodeVersionVector(live)],
      queued: [queued],
      refusal: {
        kind: refusal,
        peerFrontiers: [{ committedEndCounter: frontier, peerId: MEMBER_PEER }],
      },
    });

    expect(recovery.kind).toBe(expected);
    if (recovery.kind === "relay") {
      // The lost operations go again under their own peer, with the edit.
      expect(spansOf(recovery.update)).toEqual([
        { endCounter: 11, peerId: MEMBER_PEER, startCounter: frontier },
      ]);
      // The install records what the device knew, below which this starts.
      expect(versionVectorsEqual(recovery.committedVersion, committed)).toBe(
        true,
      );
    }
    if (recovery.kind === "rebase") recovery.fork.free();
  });

  // A relay, a rotation baseline, and a republished history each queue the
  // whole peer from counter zero. The record says those operations are
  // committed, so the queue's start does not lower what the device knows.
  const fromZero: readonly {
    readonly expected: PeerRefusalRecovery["kind"];
    readonly frontier: number;
    readonly name: string;
    readonly refusal: PeerRefusalKind;
  }[] = [
    {
      expected: "park",
      frontier: 2,
      name: "parks at a frontier that fell although its queue starts at zero",
      refusal: "peer_owned",
    },
    {
      expected: "nothing_to_relay",
      frontier: 0,
      name: "has nothing to relay when its queue already starts at zero",
      refusal: "dependency_uncommitted",
    },
    {
      expected: "rebase",
      frontier: 6,
      name: "rebases at a frontier that covers what it saw committed",
      refusal: "peer_owned",
    },
  ];

  it.each(fromZero)("$name", async ({ expected, frontier, refusal }) => {
    const { committed, live } = await deviceWithQueuedEdit();
    const recovery = planPeerRefusalRecovery({
      committedVersion: committed,
      live,
      newPeer: NEW_PEER,
      pendingBases: [encodeVersionVector(live)],
      queued: [
        {
          partialEndVersionVector: encodeVersionVector(live),
          partialStartVersionVector: encodeVersionVectorCounters({}),
        },
      ],
      refusal: {
        kind: refusal,
        peerFrontiers: [{ committedEndCounter: frontier, peerId: MEMBER_PEER }],
      },
    });

    expect(recovery.kind).toBe(expected);
    if (recovery.kind !== "rebase") return;
    // The one update still sends the queued operations under their own peer.
    expect(spansOf(recovery.update)).toEqual([
      { endCounter: 6, peerId: MEMBER_PEER, startCounter: 0 },
      { endCounter: 5, peerId: NEW_PEER, startCounter: 0 },
    ]);
    recovery.fork.free();
  });

  it("counts what is outside its queue as committed with no record of it", async () => {
    const { committed, live, queued } = await deviceWithQueuedEdit();
    // No settlement brought "hello ": the record has no committed version,
    // as for a folder's create seed. It is committed for not being queued.
    const refused = (kind: PeerRefusalKind, frontier: number) =>
      planPeerRefusalRecovery({
        committedVersion: null,
        live,
        newPeer: NEW_PEER,
        pendingBases: [encodeVersionVector(live)],
        queued: [queued],
        refusal: {
          kind,
          peerFrontiers: [
            { committedEndCounter: frontier, peerId: MEMBER_PEER },
          ],
        },
      });

    expect(refused("peer_owned", 2)).toEqual({ kind: "park" });
    const relay = refused("dependency_uncommitted", 0);
    if (relay.kind !== "relay") throw new Error("expected a relay");
    // The relay queues "hello " again, so its install must record it.
    expect(versionVectorsEqual(relay.committedVersion, committed)).toBe(true);
  });

  it("counts nothing as committed after a reset queued the whole history", async () => {
    const { live } = await deviceWithQueuedEdit();
    // A remote reset clears the record's version and queues everything.
    const recovery = planPeerRefusalRecovery({
      committedVersion: null,
      live,
      newPeer: NEW_PEER,
      pendingBases: [encodeVersionVector(live)],
      queued: [
        {
          partialEndVersionVector: encodeVersionVector(live),
          partialStartVersionVector: encodeVersionVectorCounters({}),
        },
      ],
      refusal: {
        kind: "peer_owned",
        peerFrontiers: [{ committedEndCounter: 2, peerId: MEMBER_PEER }],
      },
    });

    if (recovery.kind !== "rebase") throw new Error("expected a rebase");
    recovery.fork.free();
  });

  it("reads the record's version no further than the document it holds", async () => {
    const { live, queued } = await deviceWithQueuedEdit();
    // A fork kept six operations of a peer the record saw twenty of.
    const recovery = planPeerRefusalRecovery({
      committedVersion: encodeVersionVectorCounters({ [MEMBER_PEER]: 20 }),
      live,
      newPeer: NEW_PEER,
      pendingBases: [encodeVersionVector(live)],
      queued: [queued],
      refusal: {
        kind: "peer_owned",
        peerFrontiers: [{ committedEndCounter: 11, peerId: MEMBER_PEER }],
      },
    });

    expect(recovery).toEqual({ kind: "nothing_to_cut" });
  });
});

// The owner recovers a purged organization from a device that never saw
// some committed operations. The verdicts are the API's own rule.
describe("recovery after a stale recreation", () => {
  it("relays an interleaved history under its own peers", async () => {
    const { member, ownerDevice, stale } = await alternatingHistory(true);
    const server = new PeerServer();
    expect(server.republish(OWNER, stale).kind).toBe("accepted");
    const device = new QueueDevice(member, MEMBER);
    device.edit("ddd");

    // One refusal names the member's peer, the next the peer it builds on.
    expect(device.passes(server)).toEqual(["relay", "relay", "accepted"]);

    expect(device.doc).toBe(member);
    expect(textOf(member)).toBe("seed aaa bbb ccc ddd");
    expect(await server.readerText()).toBe("seed aaa bbb ccc ddd");
    expect(versionCounters(member).has("901")).toBe(false);
    expect(server.committed.get(MEMBER_PEER)?.ownerUserId).toBe(MEMBER);
    // The owner's other device republishes everything it holds.
    expect(server.republish(OWNER, ownerDevice)).toEqual({
      claimedPeerIds: [],
      kind: "accepted",
    });
    expect(await server.readerText()).toBe("seed aaa bbb ccc ddd");
  });

  it("relays a lost peer instead of writing it again", async () => {
    const { member, ownerDevice, stale } = await alternatingHistory(false);
    const server = new PeerServer();
    server.republish(OWNER, stale);
    const device = new QueueDevice(member, MEMBER);
    device.edit("ddd");

    expect(device.passes(server)).toEqual(["relay", "accepted"]);

    expect(await server.readerText()).toBe("seed aaa ddd");
    expect([...server.committed.keys()].sort()).toEqual([
      MEMBER_PEER,
      STALE_PEER,
    ]);
    expect(server.republish(OWNER, ownerDevice).kind).toBe("accepted");
    expect(await server.readerText()).toBe("seed aaa ddd");
    pull(member, ownerDevice);
    expect(textOf(member)).toBe("seed aaa ddd");
  });

  it("parks on a tail the owner's seed claimed, then rebases past it", async () => {
    const { member, ownerDevice, stale } = await partlySeenHistory(false);
    const server = new PeerServer();
    server.republish(OWNER, stale);
    expect(server.committed.get(MEMBER_PEER)).toEqual({
      committedEndCounter: 4,
      ownerUserId: OWNER,
    });
    const device = new QueueDevice(member, MEMBER);
    device.edit("ddd");
    const queue = [...device.queue];

    expect(device.passes(server)).toEqual(["park"]);
    expect(device.passes(server)).toEqual(["park"]);

    expect(device.queue).toEqual(queue);
    expect(device.doc).toBe(member);
    expect(await server.readerText()).toBe("seed aaa ");
    // The owner's other device restores the tail under its own ids.
    expect(server.republish(OWNER, ownerDevice).kind).toBe("accepted");
    expect(device.passes(server)).toEqual(["rebase", "accepted"]);
    expect(textOf(device.doc)).toBe("seed aaa ccc ddd");
    expect(await server.readerText()).toBe("seed aaa ccc ddd");
  });

  it("parks with its whole history queued, and writes no committed run again", async () => {
    const { member, ownerDevice, stale } = await partlySeenHistory(false);
    const server = new PeerServer();
    server.republish(OWNER, stale);
    const device = new QueueDevice(member, MEMBER);
    device.edit("ddd");
    // A full-history update joins the queue and starts every peer at zero.
    device.queueFullHistory();

    // The seed claimed four operations of a peer the device saw eight of.
    expect(device.passes(server)).toEqual(["park"]);

    expect(device.doc).toBe(member);
    expect(await server.readerText()).toBe("seed aaa ");
    expect(server.republish(OWNER, ownerDevice).kind).toBe("accepted");
    expect(device.passes(server)).toEqual(["rebase", "accepted"]);
    expect(textOf(device.doc)).toBe("seed aaa ccc ddd");
    expect(await server.readerText()).toBe("seed aaa ccc ddd");
    // The owner's device holds the originals and reads each run once.
    pull(ownerDevice, device.doc);
    expect(textOf(ownerDevice)).toBe("seed aaa ccc ddd");
  });

  it("parks where a committed foreign change builds on the lost tail", async () => {
    const { member, ownerDevice, stale } = await partlySeenHistory(true);
    pull(ownerDevice, member);
    const server = new PeerServer();
    server.republish(OWNER, stale);
    const device = new QueueDevice(member, MEMBER);
    device.edit("ddd");

    expect(device.passes(server)).toEqual(["park"]);

    expect(server.republish(OWNER, ownerDevice).kind).toBe("accepted");
    expect(device.passes(server)).toEqual(["rebase", "accepted"]);
    expect(textOf(device.doc)).toBe("seed aaa ccc bbb eee ddd");
    expect(await server.readerText()).toBe("seed aaa ccc bbb eee ddd");
  });

  it("stays parked while no device of the owner holds the lost tail", async () => {
    const { member, ownerDevice, stale } = await partlySeenHistory(true);
    const server = new PeerServer();
    server.republish(OWNER, stale);
    const device = new QueueDevice(member, MEMBER);
    device.edit("ddd");
    expect(device.passes(server)).toEqual(["park"]);

    // The owner's device never pulled the member's last committed run.
    expect(server.republish(OWNER, ownerDevice).kind).toBe("accepted");

    expect(device.passes(server)).toEqual(["park"]);
    expect(await server.readerText()).toBe("seed aaa ccc bbb ");
  });

  // With no settlement on record, the device knows the lost operations are
  // committed only for being outside its queue, until its relay queues them.
  // The relay's install records what it knew, so the park still holds.
  it.each([
    { name: "a settlement recorded", recorded: true },
    { name: "only the queue shows", recorded: false },
  ])(
    "relays what it may, parks on the rest, and writes neither again when $name what is committed",
    async ({ recorded }) => {
      // The stale device saw half of the owner's second device's peer.
      const stale = await documentOnPeer(Number(STALE_PEER));
      append(stale, "seed ");
      const ownerDevice = await documentOnPeer(Number(OWNER_DEVICE_PEER));
      pull(ownerDevice, stale);
      append(ownerDevice, "bb ");
      pull(stale, ownerDevice);
      append(ownerDevice, "BB ");
      const member = await documentOnPeer(Number(MEMBER_PEER));
      pull(member, ownerDevice);
      append(member, "aaa ");
      pull(ownerDevice, member);
      const server = new PeerServer();
      server.republish(OWNER, stale);
      const device = new QueueDevice(member, MEMBER, recorded);
      device.edit("ddd");

      // It restores its own unowned peer, tries the owner's, and is refused
      // there as another user's. Its queue now starts below what it saw
      // committed on that peer, and it still parks instead of cutting.
      expect(device.passes(server)).toEqual(["relay", "relay", "park"]);
      expect(device.passes(server)).toEqual(["park"]);

      expect(server.republish(OWNER, ownerDevice).kind).toBe("accepted");
      expect(device.passes(server)).toEqual(["rebase", "accepted"]);
      expect(textOf(device.doc)).toBe("seed bb BB aaa ddd");
      expect(await server.readerText()).toBe("seed bb BB aaa ddd");
      expect(server.submit(OWNER, [exportAllUpdates(ownerDevice)]).kind).toBe(
        "accepted",
      );
      expect(await server.readerText()).toBe("seed bb BB aaa ddd");
    },
  );
});
