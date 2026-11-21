import { expect, test } from "bun:test";
import { transitionHeldCopyCheck } from "./heldCopyCheckMachine";

const copy = { contentSha256: "1".repeat(64), storageKey: "blob-a" };
const replaced = { contentSha256: "2".repeat(64), storageKey: "blob-b" };

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
