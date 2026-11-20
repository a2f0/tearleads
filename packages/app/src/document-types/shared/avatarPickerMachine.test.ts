import { expect, test } from "bun:test";
import { transitionAvatarPicker as transition } from "./avatarPickerMachine";

test("only the active camera or photo request can open or close the crop dialog", () => {
  const idle = { status: "idle" } as const;
  const source = { blob: new Blob(["photo"]) };
  const first = transition(idle, { type: "load", request: 1 });
  const second = transition(transition(first, { type: "close" }), {
    type: "load",
    request: 2,
  });
  expect(transition(second, { type: "loaded", request: 1, source })).toBe(
    second,
  );
  expect(
    transition(second, { type: "failed", request: 1, message: "stale" }),
  ).toBe(second);
  const editing = transition(second, { type: "loaded", request: 2, source });
  expect(editing).toEqual({ status: "editing", source });
  expect(
    transition(editing, { type: "loaded", request: 2, source: null }),
  ).toBe(editing);
  expect(transition(editing, { type: "close" })).toEqual(idle);
  expect(
    transition(second, { type: "loaded", request: 2, source: null }),
  ).toEqual(idle);
  const failed = transition(second, {
    type: "failed",
    request: 2,
    message: "failed",
  });
  expect(failed).toEqual({ status: "failed", message: "failed" });
  expect(transition(failed, { type: "pick", source })).toEqual(editing);
});
