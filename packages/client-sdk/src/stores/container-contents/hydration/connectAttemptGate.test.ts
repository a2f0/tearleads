import { expect, test } from "bun:test";
import {
  isConnectAttemptSettled,
  releaseSettledConnectAttemptWaits,
  waitForPendingConnectAttempt,
} from "./connectAttemptGate";

function gateState(pendingConnectAttempt?: number) {
  return {
    runtime: {
      state: { serverEventsPendingConnectAttempt: pendingConnectAttempt },
    },
  };
}

/** Whether `wait` has resolved once queued microtasks ran. */
async function isResolved(wait: Promise<void>): Promise<boolean> {
  let resolved = false;
  void wait.then(() => {
    resolved = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return resolved;
}

test("a wait is over once its attempt is no longer the pending one", () => {
  expect(isConnectAttemptSettled(3, 3)).toBe(false);
  // Acknowledged or ended: nothing is pending.
  expect(isConnectAttemptSettled(3, undefined)).toBe(true);
  // A retry replaced it.
  expect(isConnectAttemptSettled(3, 4)).toBe(true);
});

test("with no connect attempt pending there is nothing to wait for", async () => {
  expect(await isResolved(waitForPendingConnectAttempt(gateState()))).toBe(
    true,
  );
});

test.each([
  ["is acknowledged or ends", undefined],
  ["is replaced by a retry", 8],
])("a wait holds until its attempt %s", async (_name, next) => {
  const state = gateState(7);
  const wait = waitForPendingConnectAttempt(state);

  // Runtime updates that leave the attempt pending release nothing.
  releaseSettledConnectAttemptWaits(state);
  expect(await isResolved(wait)).toBe(false);

  state.runtime.state.serverEventsPendingConnectAttempt = next;
  releaseSettledConnectAttemptWaits(state);
  expect(await isResolved(wait)).toBe(true);
});

test("a reset or retired store releases every wait", async () => {
  const state = gateState(7);
  const waits = [
    waitForPendingConnectAttempt(state),
    waitForPendingConnectAttempt(state),
  ];

  releaseSettledConnectAttemptWaits(state, { all: true });

  for (const wait of waits) expect(await isResolved(wait)).toBe(true);
  // Released waits are forgotten: a later release has nothing to do.
  releaseSettledConnectAttemptWaits(state, { all: true });
  releaseSettledConnectAttemptWaits(gateState(), { all: true });
});
