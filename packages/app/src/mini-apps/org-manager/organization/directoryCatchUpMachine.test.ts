import { expect, test } from "bun:test";
import {
  type DirectoryCatchUpState,
  initialDirectoryCatchUp,
  transitionDirectoryCatchUp,
} from "./directoryCatchUpMachine";

const INACTIVE: DirectoryCatchUpState = { status: "inactive" };
const AWAITING_A: DirectoryCatchUpState = { key: "a", status: "awaiting" };
const SETTLED_A: DirectoryCatchUpState = { key: "a", status: "settled" };

test("a subscribable key starts awaiting; none starts inactive", () => {
  expect(initialDirectoryCatchUp("a")).toEqual(AWAITING_A);
  expect(initialDirectoryCatchUp(null)).toEqual(INACTIVE);
});

test("demand for a new key awaits that key's own catch-up", () => {
  expect(
    transitionDirectoryCatchUp(INACTIVE, { type: "demand", key: "a" }),
  ).toEqual(AWAITING_A);
  expect(
    transitionDirectoryCatchUp(AWAITING_A, { type: "demand", key: "b" }),
  ).toEqual({ key: "b", status: "awaiting" });
  // A reconnect or scope change after settling must wait again.
  expect(
    transitionDirectoryCatchUp(SETTLED_A, { type: "demand", key: "b" }),
  ).toEqual({ key: "b", status: "awaiting" });
});

test("losing demand goes inactive from either keyed state", () => {
  expect(
    transitionDirectoryCatchUp(AWAITING_A, { type: "demand", key: null }),
  ).toEqual(INACTIVE);
  expect(
    transitionDirectoryCatchUp(SETTLED_A, { type: "demand", key: null }),
  ).toEqual(INACTIVE);
});

test("unchanged demand returns the same state, so render settles", () => {
  expect(
    transitionDirectoryCatchUp(INACTIVE, { type: "demand", key: null }),
  ).toBe(INACTIVE);
  expect(
    transitionDirectoryCatchUp(AWAITING_A, { type: "demand", key: "a" }),
  ).toBe(AWAITING_A);
  expect(
    transitionDirectoryCatchUp(SETTLED_A, { type: "demand", key: "a" }),
  ).toBe(SETTLED_A);
});

test("only the awaited key's settlement ends the wait", () => {
  expect(
    transitionDirectoryCatchUp(AWAITING_A, { type: "settle", key: "a" }),
  ).toEqual(SETTLED_A);
  // A superseded subscription settling late must not end the current wait.
  expect(
    transitionDirectoryCatchUp(AWAITING_A, { type: "settle", key: "b" }),
  ).toBe(AWAITING_A);
  expect(
    transitionDirectoryCatchUp(INACTIVE, { type: "settle", key: "a" }),
  ).toBe(INACTIVE);
  expect(
    transitionDirectoryCatchUp(SETTLED_A, { type: "settle", key: "a" }),
  ).toBe(SETTLED_A);
});
