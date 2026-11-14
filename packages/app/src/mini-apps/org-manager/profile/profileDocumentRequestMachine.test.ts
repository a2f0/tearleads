import { expect, test } from "bun:test";
import {
  type ProfileDocumentRequestState,
  transitionProfileDocumentRequest,
} from "./profileDocumentRequestMachine";

test("profile requests accept only the current loading request's completion", () => {
  const first = {};
  const second = {};
  const last = {};
  let state: ProfileDocumentRequestState<string> = {
    status: "loading",
    request: first,
  };
  state = transitionProfileDocumentRequest<string>(state, {
    type: "started",
    request: second,
  });
  state = transitionProfileDocumentRequest<string>(state, {
    type: "started",
    request: last,
  });
  for (const request of [first, second]) {
    expect(
      transitionProfileDocumentRequest<string>(state, {
        type: "resolved",
        request,
        value: "stale",
      }),
    ).toBe(state);
    expect(
      transitionProfileDocumentRequest<string>(state, {
        type: "unavailable",
        request,
      }),
    ).toBe(state);
  }
  state = transitionProfileDocumentRequest<string>(state, {
    type: "resolved",
    request: last,
    value: "current",
  });
  expect(state).toEqual({ status: "ready", request: last, value: "current" });
  expect(
    transitionProfileDocumentRequest<string>(state, {
      type: "unavailable",
      request: last,
    }),
  ).toBe(state);
  expect(
    transitionProfileDocumentRequest<string>(state, {
      type: "resolved",
      request: last,
      value: "late",
    }),
  ).toBe(state);
  state = transitionProfileDocumentRequest<string>(state, {
    type: "started",
    request: second,
  });
  state = transitionProfileDocumentRequest<string>(state, {
    type: "unavailable",
    request: second,
  });
  expect(state).toEqual({ status: "unavailable", request: second });
  expect(
    transitionProfileDocumentRequest<string>(state, {
      type: "resolved",
      request: second,
      value: "late",
    }),
  ).toBe(state);
  expect(
    transitionProfileDocumentRequest<string>(state, {
      type: "unavailable",
      request: second,
    }),
  ).toBe(state);
  expect(
    transitionProfileDocumentRequest<string>(state, {
      type: "started",
      request: last,
    }),
  ).toEqual({ status: "loading", request: last });
});
