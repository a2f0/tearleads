import { expect, test } from "bun:test";
import { transitionHeldCopyCheck } from "./heldCopyCheckMachine";

const blobStore = {};
const copy = { blobStore, contentSha256: "1".repeat(64), storageKey: "blob-a" };
const replaced = { ...copy, contentSha256: "2".repeat(64) };

test("a copy is checked once; a different copy starts a new check", () => {
  const checking = transitionHeldCopyCheck(undefined, {
    type: "checkStarted",
    attempt: 1,
    copy,
  });
  expect(checking).toEqual({ status: "checking", attempt: 1, copy });
  expect(
    transitionHeldCopyCheck(checking, {
      type: "checkStarted",
      attempt: 2,
      copy: { ...copy },
    }),
  ).toBe(checking);
  expect(
    transitionHeldCopyCheck(checking, {
      type: "checkStarted",
      attempt: 3,
      copy: replaced,
    }),
  ).toEqual({ status: "checking", attempt: 3, copy: replaced });
});

test("only the current attempt settles a check", () => {
  const checking = transitionHeldCopyCheck(undefined, {
    type: "checkStarted",
    attempt: 4,
    copy,
  });
  expect(
    transitionHeldCopyCheck(checking, {
      type: "checkFinished",
      attempt: 3,
      result: "missing",
    }),
  ).toBe(checking);
  expect(
    transitionHeldCopyCheck(checking, {
      type: "checkFinished",
      attempt: 4,
      result: "damaged",
    }),
  ).toEqual({ status: "unavailable", copy, reason: "damaged" });
  expect(
    transitionHeldCopyCheck(checking, {
      type: "checkFinished",
      attempt: 4,
      result: "present",
    }),
  ).toEqual({ status: "verified", copy });
});

test("bytes this store wrote supersede a check still reading the old file", () => {
  const checking = transitionHeldCopyCheck(undefined, {
    type: "checkStarted",
    attempt: 5,
    copy,
  });
  const written = transitionHeldCopyCheck(checking, {
    type: "copyWritten",
    copy,
  });
  expect(written).toEqual({ status: "verified", copy });
  expect(
    transitionHeldCopyCheck(written, {
      type: "checkFinished",
      attempt: 5,
      result: "missing",
    }),
  ).toBe(written);
});

test("an abandoned read leaves the copy unchecked for its next access", () => {
  const checking = transitionHeldCopyCheck(undefined, {
    type: "checkStarted",
    attempt: 6,
    copy,
  });
  expect(
    transitionHeldCopyCheck(checking, { type: "checkAbandoned", attempt: 5 }),
  ).toBe(checking);
  expect(
    transitionHeldCopyCheck(checking, { type: "checkAbandoned", attempt: 6 }),
  ).toBeUndefined();
  // The same key in another blob store is another copy.
  expect(
    transitionHeldCopyCheck(checking, {
      type: "checkStarted",
      attempt: 7,
      copy: { ...copy, blobStore: {} },
    }),
  ).toMatchObject({ status: "checking", attempt: 7 });
});
