import { expect, test } from "bun:test";
import { type Change, LoroMap, type PeerID } from "loro-crdt";
import {
  createDocument,
  createReadOnlyDocument,
  derivePeerId,
  exportAllUpdates,
  exportFullHistorySnapshot,
  type HistoryStop,
  importSnapshot,
  importUpdates,
  openHistoryViewer,
  orderHistoryStops,
} from "./index";

type Doc = Awaited<ReturnType<typeof createDocument>>;

function append(doc: Doc, value: string, timestamp: number): void {
  const text = doc.getText("text");
  text.insert(text.length, value);
  doc.commit({ timestamp });
}

function viewerFor(doc: Doc) {
  const scratch = createReadOnlyDocument();
  importSnapshot(scratch, exportFullHistorySnapshot(doc));
  return openHistoryViewer(scratch);
}

function change(
  peer: PeerID,
  counter: number,
  input: Partial<Omit<Change, "counter" | "peer">> = {},
): Change {
  return {
    counter,
    deps: [],
    lamport: counter,
    length: 1,
    message: undefined,
    peer,
    timestamp: 0,
    ...input,
  };
}

function labels(stops: readonly HistoryStop[]): string[] {
  return stops.map((stop) => `${stop.peerId}@${stop.startCounter}`);
}

test("the timeline replays one writer's edits in the order they were made", async () => {
  const doc = await createDocument("solo");
  const start = 1_800_000_000;
  append(doc, "one", start);
  append(doc, " two", start + 60);
  append(doc, " three", start + 120);

  const viewer = viewerFor(doc);
  try {
    expect(viewer.stops.map((stop) => stop.timestamp)).toEqual([
      start,
      start + 60,
      start + 120,
    ]);
    const seen: string[] = [];
    for (let index = -1; index < viewer.stops.length; index += 1) {
      viewer.checkout(index);
      seen.push(viewer.doc.getText("text").toString());
    }
    expect(seen).toEqual(["", "one", "one two", "one two three"]);
    // Scrubbing backwards lands on the same versions.
    viewer.checkout(0);
    expect(viewer.doc.getText("text").toString()).toBe("one");
  } finally {
    viewer.free();
  }
});

test("concurrent writers interleave by the time each change was recorded", async () => {
  const alice = await createDocument("alice");
  const bob = await createDocument("bob");
  const alicePeer = await derivePeerId("alice");
  const bobPeer = await derivePeerId("bob");
  const start = 1_800_000_000;
  append(alice, "base", start);
  importUpdates(bob, [exportAllUpdates(alice)]);
  // Offline from each other: Bob's edit is recorded between Alice's two.
  append(alice, " A1", start + 10);
  append(bob, " B1", start + 20);
  append(alice, " A2", start + 30);
  importUpdates(alice, [exportAllUpdates(bob)]);

  const viewer = viewerFor(alice);
  try {
    expect(viewer.stops.map((stop) => stop.peerId)).toEqual([
      alicePeer,
      alicePeer,
      bobPeer,
      alicePeer,
    ]);
    viewer.checkout(1);
    expect(viewer.doc.getText("text").toString()).toBe("base A1");
    viewer.checkout(2);
    expect(viewer.doc.getText("text").toString()).toContain("B1");
    expect(viewer.doc.getText("text").toString()).not.toContain("A2");
    viewer.checkout(3);
    expect(viewer.doc.getText("text").toString()).toBe(
      alice.getText("text").toString(),
    );
  } finally {
    viewer.free();
  }
});

test("nested rows replay cell by cell", async () => {
  const doc = await createDocument("rows");
  const start = 1_800_000_000;
  const rows = doc.getList("rows");
  const home = rows.insertContainer(0, new LoroMap());
  home.set("street", "1 Analytical Way");
  doc.commit({ timestamp: start });
  home.set("street", "2 Engine Road");
  doc.commit({ timestamp: start + 60 });
  rows.delete(0, 1);
  doc.commit({ timestamp: start + 120 });

  const viewer = viewerFor(doc);
  try {
    const seen: unknown[] = [];
    for (let index = 0; index < viewer.stops.length; index += 1) {
      viewer.checkout(index);
      seen.push(viewer.doc.getList("rows").toJSON());
    }
    expect(seen).toEqual([
      [{ street: "1 Analytical Way" }],
      [{ street: "2 Engine Road" }],
      [],
    ]);
  } finally {
    viewer.free();
  }
});

test("every prefix of the timeline is a version the document really had", async () => {
  const peers = await Promise.all(
    ["p1", "p2", "p3"].map((seed) => createDocument(seed)),
  );
  let time = 1_800_000_000;
  for (let round = 0; round < 12; round += 1) {
    for (const [index, doc] of peers.entries()) {
      time += 3;
      append(doc, `${index}`, time);
      doc.getMap("fields").set(`f${round % 3}`, round);
      doc.commit({ timestamp: time });
    }
    if (round % 2 === 1) {
      const updates = peers.map((doc) => exportAllUpdates(doc));
      for (const doc of peers) importUpdates(doc, updates);
    }
  }
  const updates = peers.map((doc) => exportAllUpdates(doc));
  const [first] = peers;
  if (!first) throw new Error("expected a peer");
  importUpdates(first, updates);

  const viewer = viewerFor(first);
  try {
    const included = new Map<PeerID, number>();
    for (const [index, stop] of viewer.stops.entries()) {
      included.set(stop.peerId, stop.endCounter);
      const closure = viewer.doc.frontiersToVV(
        viewer
          .versionAt(index)
          .map(({ counter, peerId }) => ({ counter, peer: peerId })),
      );
      // The version holds exactly the changes played so far: nothing is
      // pulled in from a change the timeline has not reached.
      expect(new Map(closure.toJSON())).toEqual(included);
    }
    viewer.checkout(viewer.stops.length - 1);
    expect(viewer.doc.toJSON()).toEqual(first.toJSON());
  } finally {
    viewer.free();
  }
});

test("a change never plays before a change it depends on, whatever the clocks say", () => {
  const stops = orderHistoryStops(
    new Map<PeerID, Change[]>([
      ["1", [change("1", 0, { timestamp: 500 })]],
      // Recorded "earlier" than the change it builds on.
      [
        "2",
        [change("2", 0, { deps: [{ counter: 0, peer: "1" }], timestamp: 100 })],
      ],
    ]),
  );

  expect(labels(stops)).toEqual(["1@0", "2@0"]);
});

test("a dependency on the middle of a change waits for the whole change", () => {
  const stops = orderHistoryStops(
    new Map<PeerID, Change[]>([
      ["1", [change("1", 0, { length: 8, timestamp: 300 })]],
      [
        "2",
        [change("2", 0, { deps: [{ counter: 4, peer: "1" }], timestamp: 200 })],
      ],
    ]),
  );

  expect(labels(stops)).toEqual(["1@0", "2@0"]);
});

test("a peer's own changes play in counter order", () => {
  const stops = orderHistoryStops(
    new Map<PeerID, Change[]>([
      [
        "1",
        [
          change("1", 5, { timestamp: 100 }),
          change("1", 0, { length: 5, timestamp: 900 }),
        ],
      ],
    ]),
  );

  expect(labels(stops)).toEqual(["1@0", "1@5"]);
});

test("ties break by Lamport time and then peer, independent of input order", () => {
  const first: [PeerID, Change[]] = [
    "20",
    [change("20", 0, { lamport: 4, timestamp: 100 })],
  ];
  const second: [PeerID, Change[]] = [
    "3",
    [change("3", 0, { lamport: 4, timestamp: 100 })],
  ];
  const third: [PeerID, Change[]] = [
    "100",
    [change("100", 0, { lamport: 2, timestamp: 100 })],
  ];
  const expected = ["100@0", "3@0", "20@0"];

  expect(labels(orderHistoryStops(new Map([first, second, third])))).toEqual(
    expected,
  );
  expect(labels(orderHistoryStops(new Map([third, second, first])))).toEqual(
    expected,
  );
});

test("changes without a recorded time fall back to causal order", () => {
  const stops = orderHistoryStops(
    new Map<PeerID, Change[]>([
      ["1", [change("1", 0, { lamport: 0 }), change("1", 1, { lamport: 3 })]],
      ["2", [change("2", 0, { lamport: 1 })]],
    ]),
  );

  expect(labels(stops)).toEqual(["1@0", "2@0", "1@1"]);
  expect(stops.every((stop) => stop.timestamp === null)).toBe(true);
});

test("a dependency on history that is not held is ignored", () => {
  const stops = orderHistoryStops(
    new Map<PeerID, Change[]>([
      ["2", [change("2", 0, { deps: [{ counter: 9, peer: "7" }] })]],
    ]),
  );

  expect(labels(stops)).toEqual(["2@0"]);
});

test("a stop outside the timeline is refused", async () => {
  const doc = await createDocument("range");
  append(doc, "only", 1_800_000_000);
  const viewer = viewerFor(doc);
  try {
    expect(() => viewer.checkout(1)).toThrow(RangeError);
    expect(() => viewer.versionAt(-2)).toThrow(RangeError);
    expect(() => viewer.versionAt(0.5)).toThrow(RangeError);
  } finally {
    viewer.free();
  }
});

test("the scratch document refuses edits once a version is checked out", async () => {
  const doc = await createDocument("readonly");
  append(doc, "kept", 1_800_000_000);
  const viewer = viewerFor(doc);
  try {
    viewer.checkout(0);
    expect(() => viewer.doc.getText("text").insert(0, "x")).toThrow();
  } finally {
    viewer.free();
  }
});
