import { expect, test } from "bun:test";
import {
  type MetadataWriterPeerEffect,
  type MetadataWriterPeerEvent,
  type MetadataWriterPeerState,
  transitionMetadataWriterPeer,
} from "./metadataWriterPeerMachine";

type State = MetadataWriterPeerState<string>;

const none: State = { status: "none" };
const held: State = { end: 3, status: "held" };
const lent: State = { borrower: "copy", end: 3, status: "lent" };
const lentToGone: State = { borrower: undefined, end: 3, status: "lent" };

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
    "the borrower writes a lent peer",
    lent,
    { counter: 3, doc: "copy", type: "localWrite" },
    lent,
    "write",
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
    { end: 2, status: "held" },
    "none",
  ],
  [
    "the borrower's write raises the loan's end",
    lent,
    { counter: 5, type: "wrote" },
    { borrower: "copy", end: 5, status: "lent" },
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
    { borrower: "copy", end: 0, status: "lent" },
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
    { end: 4, status: "held" },
    "none",
  ],
  [
    "a merged borrower returns the peer",
    lent,
    { copy: "copy", counter: 4, type: "copyMerged" },
    { end: 4, status: "held" },
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
];

for (const [name, state, event, nextState, effect] of cases) {
  test(`writer peer: ${name}`, () => {
    expect(transitionMetadataWriterPeer(state, event)).toEqual({
      effect,
      state: nextState,
    });
  });
}
