import { expect, test } from "bun:test";
import type { DocumentListingRevalidation } from "../../../../workflows/documents";
import {
  type OwedListingReadState,
  transitionOwedListingRead,
} from "./owedListingReadMachine";

function debt(revision: string): DocumentListingRevalidation {
  return {
    advertisedAccessEpoch: 1,
    advertisedUpdateCount: 3,
    documentId: "doc",
    localId: "local",
    revision,
  };
}

const FIRST = debt("first");
const RENEWED = debt("renewed");
const owed = (read: DocumentListingRevalidation): OwedListingReadState => ({
  read,
  status: "owed",
});
const retried = (read: DocumentListingRevalidation): OwedListingReadState => ({
  read,
  status: "retried",
});

test("reading the debt records it, and reading none clears it", () => {
  expect(
    transitionOwedListingRead(null, { read: FIRST, type: "observed" }),
  ).toEqual(owed(FIRST));
  expect(
    transitionOwedListingRead(owed(FIRST), { read: null, type: "observed" }),
  ).toBeNull();
  expect(
    transitionOwedListingRead(retried(FIRST), { read: null, type: "observed" }),
  ).toBeNull();
});

test("reading the same debt again keeps that it was retried", () => {
  const state = retried(FIRST);
  expect(
    transitionOwedListingRead(state, { read: FIRST, type: "observed" }),
  ).toBe(state);
});

test("a renewed debt is owed, and retried, afresh", () => {
  expect(
    transitionOwedListingRead(retried(FIRST), {
      read: RENEWED,
      type: "observed",
    }),
  ).toEqual(owed(RENEWED));
});

test("an unpaid debt is retried once", () => {
  const first = transitionOwedListingRead(owed(FIRST), {
    read: FIRST,
    type: "unpaid",
  });
  expect(first).toEqual(retried(FIRST));
  // The same state back means no second retry is asked for.
  expect(
    transitionOwedListingRead(first, { read: FIRST, type: "unpaid" }),
  ).toBe(first);
  // A pull can carry a debt the store had not recorded.
  expect(
    transitionOwedListingRead(null, { read: FIRST, type: "unpaid" }),
  ).toEqual(retried(FIRST));
});

test("a pull that answered an older revision leaves the renewed debt alone", () => {
  const state = owed(RENEWED);
  expect(
    transitionOwedListingRead(state, { read: FIRST, type: "unpaid" }),
  ).toBe(state);
  expect(transitionOwedListingRead(state, { read: FIRST, type: "paid" })).toBe(
    state,
  );
});

test("paying the debt the store knows clears it", () => {
  expect(
    transitionOwedListingRead(retried(FIRST), { read: FIRST, type: "paid" }),
  ).toBeNull();
  expect(
    transitionOwedListingRead(null, { read: FIRST, type: "paid" }),
  ).toBeNull();
});

const WITHHELD: OwedListingReadState = { status: "withheld" };

const SENDABLE = { type: "cursorRead", withheld: false } as const;
const UNSENDABLE = { type: "cursorRead", withheld: true } as const;

test("a withheld cursor obliges a pull until the cursor can be sent", () => {
  expect(transitionOwedListingRead(null, UNSENDABLE)).toEqual(WITHHELD);
  // Reading that no listing owes a read does not clear it.
  expect(
    transitionOwedListingRead(WITHHELD, { read: null, type: "observed" }),
  ).toBe(WITHHELD);
  expect(transitionOwedListingRead(WITHHELD, UNSENDABLE)).toBe(WITHHELD);
  // A pull that left a cursor the next one sends, or a reload that finds
  // one on disk, ends it.
  expect(transitionOwedListingRead(WITHHELD, SENDABLE)).toBeNull();
});

test("a debt takes the place of a withheld cursor, and keeps its own", () => {
  // The pull that pays the debt is the pull that judges again.
  expect(
    transitionOwedListingRead(WITHHELD, { read: FIRST, type: "observed" }),
  ).toEqual(owed(FIRST));
  expect(
    transitionOwedListingRead(WITHHELD, { read: FIRST, type: "unpaid" }),
  ).toEqual(retried(FIRST));
  for (const state of [owed(FIRST), retried(FIRST)]) {
    expect(transitionOwedListingRead(state, UNSENDABLE)).toBe(state);
    // Only a pull that covers the advertised count pays a debt.
    expect(transitionOwedListingRead(state, SENDABLE)).toBe(state);
  }
  expect(transitionOwedListingRead(null, SENDABLE)).toBeNull();
});
