import { expect, test } from "bun:test";
import {
  type AuthenticateActionEvent,
  type AuthenticateActionState,
  INITIAL_AUTHENTICATE_ACTION_STATE,
  transitionAuthenticateAction,
} from "./authenticateActionMachine";

function run(
  events: readonly AuthenticateActionEvent[],
  from: AuthenticateActionState = INITIAL_AUTHENTICATE_ACTION_STATE,
): AuthenticateActionState {
  return events.reduce(transitionAuthenticateAction, from);
}

const ASKED: AuthenticateActionEvent = {
  message: "Enter the code",
  prompt: "two_factor_required",
  type: "second-factor-refused",
};

test("a second-factor refusal keeps the prompt through the next attempt", () => {
  const asked = run([{ type: "started" }, ASKED]);
  expect(asked).toEqual({
    message: "Enter the code",
    prompt: "two_factor_required",
    status: "failed",
  });
  expect(run([{ type: "started" }], asked)).toEqual({
    prompt: "two_factor_required",
    status: "authenticating",
  });
  expect(run([{ type: "started" }, { type: "succeeded" }], asked)).toEqual(
    INITIAL_AUTHENTICATE_ACTION_STATE,
  );
});

test("an ordinary failure keeps a prompt that was showing", () => {
  expect(
    run([ASKED, { type: "started" }, { message: "Offline", type: "failed" }]),
  ).toEqual({
    message: "Offline",
    prompt: "two_factor_required",
    status: "failed",
  });
  expect(
    run([{ type: "started" }, { message: "Offline", type: "failed" }]),
  ).toEqual({ message: "Offline", prompt: null, status: "failed" });
});

test("dismissing clears the error and the prompt, not an attempt in flight", () => {
  expect(run([ASKED, { type: "dismissed" }])).toEqual(
    INITIAL_AUTHENTICATE_ACTION_STATE,
  );
  expect(run([ASKED, { type: "started" }, { type: "dismissed" }])).toEqual({
    prompt: null,
    status: "authenticating",
  });
});
