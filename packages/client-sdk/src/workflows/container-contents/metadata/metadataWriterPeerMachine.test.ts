import { expect, test } from "bun:test";
import {
  type MetadataWriterPeerEffect,
  type MetadataWriterPeerEvent,
  type MetadataWriterPeerState,
  transitionMetadataWriterPeer,
} from "./metadataWriterPeerMachine";

type State = MetadataWriterPeerState<string>;

const none: State = { status: "none" };
const held: State = { end: 3, status: "held", written: 3 };
const lent: State = { borrower: "copy", end: 3, status: "lent", written: 3 };
const lentToGone: State = {
  borrower: undefined,
  end: 3,
  status: "lent",
  written: 3,
};
/** A served page took the peer from 3 to 7; nothing here wrote past 3. */
const extended: State = { end: 7, status: "held", written: 3 };
const lentExtended: State = {
  borrower: "copy",
  end: 7,
  status: "lent",
  written: 3,
};

const cases: ReadonlyArray<
  readonly [
    string,
    State,
    MetadataWriterPeerEvent<string>,
    State,
    MetadataWriterPeerEffect,
  ]
> = [
  [
    "a first write may write",
    none,
    { counter: 0, doc: "live", type: "localWrite" },
    none,
    "write",
  ],
  [
    "a document at the peer's end may write",
    held,
    { counter: 3, doc: "reloaded", type: "localWrite" },
    held,
    "write",
  ],
  [
    "a document behind the peer's end moves off it",
    held,
    { counter: 2, doc: "stale", type: "localWrite" },
    held,
    "switchToFreshPeer",
  ],
  [
    "a document that lacks a served page moves off the peer",
    extended,
    { counter: 3, doc: "stale", type: "localWrite" },
    extended,
    "switchToFreshPeer",
  ],
  [
    "a document that holds a served page writes after it",
    extended,
    { counter: 7, doc: "live", type: "localWrite" },
    extended,
    "write",
  ],
  [
    "the borrower writes a lent peer",
    lent,
    { counter: 3, doc: "copy", type: "localWrite" },
    lent,
    "write",
  ],
  [
    "a borrower that lacks a served page moves off the peer",
    lentExtended,
    { counter: 3, doc: "copy", type: "localWrite" },
    lentExtended,
    "switchToFreshPeer",
  ],
  [
    "no one else writes a lent peer",
    lent,
    { counter: 3, doc: "live", type: "localWrite" },
    lent,
    "switchToFreshPeer",
  ],
  [
    "a dropped borrower's loan never ends",
    lentToGone,
    { counter: 9, doc: "live", type: "localWrite" },
    lentToGone,
    "switchToFreshPeer",
  ],
  [
    "a write raises the end",
    none,
    { counter: 2, type: "wrote" },
    { end: 2, status: "held", written: 2 },
    "none",
  ],
  [
    "a write after a served page raises both counters past it",
    extended,
    { counter: 9, type: "wrote" },
    { end: 9, status: "held", written: 9 },
    "none",
  ],
  [
    "the borrower's write raises the loan's end",
    lent,
    { counter: 5, type: "wrote" },
    { borrower: "copy", end: 5, status: "lent", written: 5 },
    "none",
  ],
  [
    "a copy at the end borrows a held peer",
    held,
    { copy: "copy", counter: 3, type: "copyFirstWrite" },
    lent,
    "takePeer",
  ],
  [
    "a copy borrows an unused peer",
    none,
    { copy: "copy", counter: 0, type: "copyFirstWrite" },
    { borrower: "copy", end: 0, status: "lent", written: 0 },
    "takePeer",
  ],
  [
    "a copy behind the end keeps its own peer",
    held,
    { copy: "copy", counter: 2, type: "copyFirstWrite" },
    held,
    "keepOwnPeer",
  ],
  [
    "a copy that lacks a served page keeps its own peer",
    extended,
    { copy: "copy", counter: 3, type: "copyFirstWrite" },
    extended,
    "keepOwnPeer",
  ],
  [
    "a copy that holds a served page borrows the peer",
    extended,
    { copy: "copy", counter: 7, type: "copyFirstWrite" },
    lentExtended,
    "takePeer",
  ],
  [
    "a second copy keeps its own peer",
    lent,
    { copy: "other", counter: 3, type: "copyFirstWrite" },
    lent,
    "keepOwnPeer",
  ],
  [
    "an installed borrower holds the peer",
    lent,
    { copy: "copy", copyWrote: true, counter: 4, type: "copyInstalled" },
    { end: 4, status: "held", written: 3 },
    "none",
  ],
  [
    "a merged borrower returns the peer",
    lent,
    { copy: "copy", counter: 4, type: "copyMerged" },
    { end: 4, status: "held", written: 3 },
    "none",
  ],
  [
    "settling another copy leaves the loan",
    lent,
    { copy: "other", counter: 3, type: "copyMerged" },
    lent,
    "none",
  ],
  [
    "an installed copy that never wrote continues the peer",
    held,
    { copy: "copy", copyWrote: false, counter: 3, type: "copyInstalled" },
    held,
    "takePeer",
  ],
  [
    "an installed pass that imported a served page continues the peer",
    extended,
    { copy: "pass", copyWrote: false, counter: 7, type: "copyInstalled" },
    extended,
    "takePeer",
  ],
  [
    "an installed copy behind the end keeps its own peer",
    held,
    { copy: "copy", copyWrote: false, counter: 2, type: "copyInstalled" },
    held,
    "none",
  ],
  [
    "an installed copy that wrote keeps its own peer",
    held,
    { copy: "copy", copyWrote: true, counter: 3, type: "copyInstalled" },
    held,
    "none",
  ],
  [
    "a merged copy that never borrowed changes nothing",
    held,
    { copy: "copy", counter: 3, type: "copyMerged" },
    held,
    "none",
  ],
  [
    "a served page extends a peer nothing here wrote",
    none,
    { counter: 0, end: 4, type: "remoteExtended" },
    { end: 4, status: "held", written: 0 },
    "import",
  ],
  [
    "a served page extends a held peer for an importer that holds its writes",
    held,
    { counter: 3, end: 7, type: "remoteExtended" },
    extended,
    "import",
  ],
  [
    "a served page collides with writes its importer lacks",
    held,
    { counter: 2, end: 7, type: "remoteExtended" },
    held,
    "collide",
  ],
  [
    "a served page collides with a borrower's writes its importer lacks",
    { borrower: "copy", end: 5, status: "lent", written: 5 },
    { counter: 3, end: 7, type: "remoteExtended" },
    { borrower: "copy", end: 5, status: "lent", written: 5 },
    "collide",
  ],
  [
    "a served page extends a lent peer whose borrower wrote nothing past the importer",
    lent,
    { counter: 3, end: 7, type: "remoteExtended" },
    lentExtended,
    "import",
  ],
  [
    "a page served again after its pass failed is imported, not refused",
    extended,
    { counter: 3, end: 7, type: "remoteExtended" },
    extended,
    "import",
  ],
  [
    "a served page never lowers the end",
    extended,
    { counter: 3, end: 5, type: "remoteExtended" },
    extended,
    "import",
  ],
];

for (const [name, state, event, nextState, effect] of cases) {
  test(`writer peer: ${name}`, () => {
    expect(transitionMetadataWriterPeer(state, event)).toEqual({
      effect,
      state: nextState,
    });
  });
}
