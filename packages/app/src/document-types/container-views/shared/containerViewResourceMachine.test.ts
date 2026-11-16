import { expect, test } from "bun:test";
import { transitionContainerViewResource } from "./containerViewResourceMachine";

test("replacement requests ignore old success/failure and retain terminal states", () => {
  const first = {};
  const second = {};
  const loading = transitionContainerViewResource<string>(
    { status: "loading", request: first },
    { type: "start", request: second },
  );
  expect(
    transitionContainerViewResource(loading, {
      type: "loaded",
      request: first,
      value: "old",
    }),
  ).toBe(loading);
  expect(
    transitionContainerViewResource(loading, {
      type: "failed",
      request: first,
      error: "old",
    }),
  ).toBe(loading);
  const ready = transitionContainerViewResource(loading, {
    type: "loaded",
    request: second,
    value: "new",
  });
  expect(ready).toEqual({ status: "ready", request: second, value: "new" });
  expect(
    transitionContainerViewResource(ready, {
      type: "failed",
      request: second,
      error: "late",
    }),
  ).toBe(ready);
});
