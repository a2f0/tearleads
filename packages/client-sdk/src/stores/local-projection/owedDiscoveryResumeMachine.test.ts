import { expect, test } from "bun:test";
import {
  INITIAL_OWED_DISCOVERY_RESUME,
  type OwedDiscoveryResumeEvent,
  type OwedDiscoveryResumeState,
  transitionOwedDiscoveryResume,
} from "./owedDiscoveryResumeMachine";

const AWAITING_ACK: OwedDiscoveryResumeState = {
  attempt: 7,
  status: "awaiting-acknowledgement",
};
const DONE: OwedDiscoveryResumeState = { status: "done" };

function hydrated(
  acknowledged: boolean,
  pendingConnectAttempt: number | undefined,
): OwedDiscoveryResumeEvent {
  return { acknowledged, pendingConnectAttempt, type: "hydrated" };
}

function runtime(
  acknowledged: boolean,
  pendingConnectAttempt: number | undefined,
): OwedDiscoveryResumeEvent {
  return { acknowledged, pendingConnectAttempt, type: "runtime" };
}

test.each([
  [
    "hydration with no attempt pending resumes at once",
    INITIAL_OWED_DISCOVERY_RESUME,
    hydrated(false, undefined),
    DONE,
    true,
  ],
  [
    "hydration while connecting waits for the acknowledgement",
    INITIAL_OWED_DISCOVERY_RESUME,
    hydrated(false, 7),
    AWAITING_ACK,
    false,
  ],
  [
    "hydration after an acknowledgement leaves it to the catch-up",
    INITIAL_OWED_DISCOVERY_RESUME,
    hydrated(true, undefined),
    DONE,
    false,
  ],
  [
    "the acknowledgement's catch-up lists the owed lanes",
    AWAITING_ACK,
    runtime(true, undefined),
    DONE,
    false,
  ],
  [
    "the same attempt still pending keeps waiting",
    AWAITING_ACK,
    runtime(false, 7),
    AWAITING_ACK,
    false,
  ],
  [
    "an attempt that ends without an acknowledgement resumes",
    AWAITING_ACK,
    runtime(false, undefined),
    DONE,
    true,
  ],
  [
    "a later attempt does not inherit the wait",
    AWAITING_ACK,
    runtime(false, 8),
    DONE,
    true,
  ],
  [
    "a runtime change before hydration does nothing",
    INITIAL_OWED_DISCOVERY_RESUME,
    runtime(false, undefined),
    INITIAL_OWED_DISCOVERY_RESUME,
    false,
  ],
  [
    "a start resumes at most once",
    DONE,
    hydrated(false, undefined),
    DONE,
    false,
  ],
  [
    "a reset waits for the next hydration",
    DONE,
    { type: "reset" } as const,
    INITIAL_OWED_DISCOVERY_RESUME,
    false,
  ],
] as const)("%s", (_name, state, event, next, resume) => {
  expect(transitionOwedDiscoveryResume(state, event)).toEqual({
    resume,
    state: next,
  });
});
