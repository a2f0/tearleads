import { expect, test } from "bun:test";
import {
  initialRequestGateState,
  transitionRequestGate,
} from "./requestGateMachine";

test("transitions pending -> held -> done and ignores redundant events", () => {
  const held = transitionRequestGate(initialRequestGateState, {
    type: "match",
  });
  expect(held).toEqual({
    state: { status: "held" },
    effects: ["notify-arrived"],
  });

  const duplicateMatch = transitionRequestGate(held.state, { type: "match" });
  expect(duplicateMatch).toEqual({
    state: { status: "held" },
    effects: [],
  });

  const released = transitionRequestGate(held.state, { type: "release" });
  expect(released).toEqual({
    state: { status: "done" },
    effects: ["resolve-release"],
  });

  expect(transitionRequestGate(released.state, { type: "cancel" })).toEqual({
    state: { status: "done" },
    effects: [],
  });
});

test("early release or cancel moves pending directly to done", () => {
  expect(
    transitionRequestGate(initialRequestGateState, { type: "release" }),
  ).toEqual({
    state: { status: "done" },
    effects: ["resolve-release"],
  });
  expect(
    transitionRequestGate(initialRequestGateState, { type: "cancel" }),
  ).toEqual({
    state: { status: "done" },
    effects: ["resolve-release"],
  });
});
