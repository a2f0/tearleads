// An update's range can hold operations that its own later operations build
// on through another peer: P writes, Q writes on top of P, P writes on top
// of Q, and one update carries all of P. What that range depends on (Q's
// change) descends from the range's first part, so a document forked at the
// range's dependencies would already hold that part. The comparison document
// must hold none of it: Loro takes a held operation that arrives again with
// another commit time or message as already held, and would hide a forgery.
import { expect, test } from "bun:test";
import { type JsonChange, LoroDoc } from "loro-crdt";
import {
  createDocument,
  exportAllUpdates,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "./document";
import { updateMatchesDocumentHistory } from "./updateIdentity";

const T0 = 1_700_000_000;

function rangeOf(doc: LoroDoc, peer: `${number}`, start: number, end: number) {
  return doc.export({
    mode: "updates-in-range",
    spans: [{ id: { counter: start, peer }, len: end - start }],
  });
}

/**
 * P's two changes, Q's change on top of them, and P's change on top of Q's.
 * `reader` received P's large change in two pieces, so it holds that change
 * across two of Loro's storage blocks. `update` is all of P.
 */
async function interleaved() {
  const p = await createDocument("overlap-p");
  const q = await createDocument("overlap-q");
  const peer = p.peerIdStr;
  p.getText("text").insert(0, "h".repeat(352));
  p.commit({ timestamp: T0 });
  p.getText("text").insert(0, "x".repeat(4214));
  p.commit({ timestamp: T0 + 60 });
  const first = p.opCount();
  importUpdates(q, [exportAllUpdates(p)]);
  q.getMap("fields").set("seen", true);
  q.commit({ timestamp: T0 + 120 });
  importUpdates(p, [exportAllUpdates(q)]);
  p.getMap("fields").set("more", true);
  p.commit({ timestamp: T0 + 180 });
  importUpdates(q, [exportAllUpdates(p)]);
  const end = p.oplogVersion().get(peer) ?? 0;
  const reader = new LoroDoc();
  importUpdates(reader, [rangeOf(p, peer, 0, 352)]);
  importUpdates(reader, [rangeOf(p, peer, 352, 3955)]);
  importUpdates(reader, [rangeOf(p, peer, 3955, first)]);
  importUpdates(reader, [exportAllUpdates(q)]);
  importUpdates(reader, [rangeOf(p, peer, first, end)]);
  const restored = new LoroDoc();
  importSnapshot(restored, exportFullHistorySnapshot(reader));
  return { end, holders: [p, q, reader, restored], p, peer };
}

test("an update that its own dependencies descend from matches every holder", async () => {
  const { end, holders, p, peer } = await interleaved();
  // All of P, and P in two parts: only the whole holds what it builds on.
  const updates = [
    rangeOf(p, peer, 0, end),
    rangeOf(p, peer, 0, 400),
    rangeOf(p, peer, 400, end),
  ];

  for (const holder of holders) {
    for (const update of updates) {
      expect(updateMatchesDocumentHistory(holder, update)).toBe(true);
    }
    holder.free();
  }
});

/** `p`'s history with `forge` applied to its first change, as P's update. */
function forgedUpdate(
  p: LoroDoc,
  end: number,
  forge: (change: JsonChange) => void,
): Uint8Array {
  const history = p.exportJsonUpdates(undefined, undefined, false);
  const change = history.changes.find((held) => held.id === `0@${p.peerIdStr}`);
  if (!change) throw new Error("No first change");
  forge(change);
  const forged = new LoroDoc();
  forged.importJsonUpdates(history);
  const update = rangeOf(forged, p.peerIdStr, 0, end);
  forged.free();
  return update;
}

test.each([
  [
    "another commit time",
    (change: JsonChange) => {
      change.timestamp += 5;
    },
  ],
  [
    "a message",
    (change: JsonChange) => {
      change.msg = "forged";
    },
  ],
  [
    "other text",
    (change: JsonChange) => {
      const [insert] = change.ops;
      if (!insert || !("text" in insert.content)) throw new Error("No insert");
      insert.content.text = `F${insert.content.text.slice(1)}`;
    },
  ],
])(
  "a forgery with %s in the part its dependencies descend from matches no holder",
  async (_name, forge) => {
    const { end, holders, p } = await interleaved();
    const forged = forgedUpdate(p, end, forge);

    for (const holder of holders) {
      expect(updateMatchesDocumentHistory(holder, forged)).toBe(false);
      holder.free();
    }
  },
);
