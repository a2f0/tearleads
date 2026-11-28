import { describe, expect, test } from "bun:test";
import {
  documentSyncPullTip,
  INITIAL_PEER_RESTORE_PARK_STATE,
  shouldDeferQueuedWritesWhileParked,
  transitionPeerRestorePark,
} from "./peerRestoreParkMachine";

const tip1 = documentSyncPullTip({
  throughUpdateCount: 1,
  throughUpdateId: "00000000-0000-4000-8000-000000000001",
});
const tip2 = documentSyncPullTip({
  throughUpdateCount: 2,
  throughUpdateId: "00000000-0000-4000-8000-000000000002",
});

describe("peerRestoreParkMachine", () => {
  test("parking triggers one immediate pull-only pass, captures the tip, and stays parked without looping", () => {
    const parked = transitionPeerRestorePark(INITIAL_PEER_RESTORE_PARK_STATE, {
      type: "parked",
    });
    expect(parked.state.status).toBe("parked_pull_needed");
    expect(parked.requestSync).toBe(true);
    expect(shouldDeferQueuedWritesWhileParked(parked.state)).toBe(true);

    // Immediate pull captures the post-recreation server tip and stops.
    const initialPull = transitionPeerRestorePark(parked.state, {
      pullTip: tip1,
      type: "pull_settled",
    });
    expect(initialPull.state).toEqual({
      observedPullTip: tip1,
      status: "parked",
    });
    expect(initialPull.requestSync).toBe(false);
    expect(shouldDeferQueuedWritesWhileParked(initialPull.state)).toBe(true);

    // Another pull with no new server commits does not probe writes.
    const idlePull = transitionPeerRestorePark(initialPull.state, {
      pullTip: tip1,
      type: "pull_settled",
    });
    expect(idlePull.state).toEqual(initialPull.state);
    expect(idlePull.requestSync).toBe(false);
  });

  test("an advancing server tip probes writes once and settles back into parked if still refused", () => {
    const parked = transitionPeerRestorePark(
      transitionPeerRestorePark(INITIAL_PEER_RESTORE_PARK_STATE, {
        type: "parked",
      }).state,
      { pullTip: tip1, type: "pull_settled" },
    );

    // A remote commit lands: the pull-only pass already pulled live reads and
    // now probes writes once.
    const probe = transitionPeerRestorePark(parked.state, {
      pullTip: tip2,
      type: "pull_settled",
    });
    expect(probe.state).toEqual({
      observedPullTip: tip2,
      retryOnPark: false,
      status: "probing_writes",
    });
    expect(probe.requestSync).toBe(true);
    expect(shouldDeferQueuedWritesWhileParked(probe.state)).toBe(false);

    // If the remote commit was only another user's edit (not the missing peer),
    // the write probe parks again at tip2 with requestSync: false (no loop).
    const reparked = transitionPeerRestorePark(probe.state, { type: "parked" });
    expect(reparked.state).toEqual({
      observedPullTip: tip2,
      status: "parked",
    });
    expect(reparked.requestSync).toBe(false);
  });

  test("peer_restore_allowed_hint probes writes and returns to active on write success", () => {
    const parked = transitionPeerRestorePark(
      transitionPeerRestorePark(INITIAL_PEER_RESTORE_PARK_STATE, {
        type: "parked",
      }).state,
      { pullTip: tip1, type: "pull_settled" },
    );

    const probing = transitionPeerRestorePark(parked.state, {
      type: "peer_restore_allowed_hint",
    });
    expect(probing.state).toEqual({
      observedPullTip: tip1,
      retryOnPark: false,
      status: "probing_writes",
    });
    expect(probing.requestSync).toBe(true);
    expect(shouldDeferQueuedWritesWhileParked(probing.state)).toBe(false);

    const cleared = transitionPeerRestorePark(probing.state, {
      type: "write_pass_succeeded",
    });
    expect(cleared.state).toEqual(INITIAL_PEER_RESTORE_PARK_STATE);
    expect(cleared.requestSync).toBe(false);
  });

  test("peer_restore_allowed_hint arriving during probing_writes retries once instead of stranding in parked", () => {
    const parked = transitionPeerRestorePark(
      transitionPeerRestorePark(INITIAL_PEER_RESTORE_PARK_STATE, {
        type: "parked",
      }).state,
      { pullTip: tip1, type: "pull_settled" },
    );
    const probing = transitionPeerRestorePark(parked.state, {
      pullTip: tip2,
      type: "pull_settled",
    });
    expect(probing.state).toEqual({
      observedPullTip: tip2,
      retryOnPark: false,
      status: "probing_writes",
    });

    // Hint arrives while the tip2 probe is already in flight.
    const hintDuringProbe = transitionPeerRestorePark(probing.state, {
      type: "peer_restore_allowed_hint",
    });
    expect(hintDuringProbe.state).toEqual({
      observedPullTip: tip2,
      retryOnPark: true,
      status: "probing_writes",
    });
    expect(hintDuringProbe.requestSync).toBe(false);

    // When the stale in-flight probe parks, retry once immediately.
    const retried = transitionPeerRestorePark(hintDuringProbe.state, {
      type: "parked",
    });
    expect(retried.state).toEqual({
      observedPullTip: tip2,
      retryOnPark: false,
      status: "probing_writes",
    });
    expect(retried.requestSync).toBe(true);

    // If the retry still parks (no further hint), settle back to parked without looping.
    const reparked = transitionPeerRestorePark(retried.state, {
      type: "parked",
    });
    expect(reparked.state).toEqual({
      observedPullTip: tip2,
      status: "parked",
    });
    expect(reparked.requestSync).toBe(false);
  });

  test("reset clears parked state cleanly", () => {
    const parked = transitionPeerRestorePark(INITIAL_PEER_RESTORE_PARK_STATE, {
      type: "parked",
    });
    const reset = transitionPeerRestorePark(parked.state, { type: "reset" });
    expect(reset.state).toEqual(INITIAL_PEER_RESTORE_PARK_STATE);
    expect(reset.requestSync).toBe(false);
  });
});
