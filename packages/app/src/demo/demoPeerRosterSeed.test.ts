import { expect, test } from "bun:test";
import { DATABASE_BUSY_RUN_LIMIT } from "@tearleads/client-sdk/sqlite";
import { KeyingVerificationError } from "@tearleads/crypto";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { fakeRosterSeedActions } from "../stores/org-manager/rosterSeed.testUtils";
import {
  attemptPeerRosterSeed,
  demoAttemptsAfterFailure,
  shouldAttemptRosterSeed,
} from "./demoPeerRosterSeed";

test("shouldAttemptRosterSeed requires write access, auth, and a peer id", () => {
  expect(
    shouldAttemptRosterSeed({
      canWrite: true,
      isAuthenticated: true,
      peerUserId: "peer",
    }),
  ).toBe(true);
  expect(
    shouldAttemptRosterSeed({
      canWrite: false,
      isAuthenticated: true,
      peerUserId: "peer",
    }),
  ).toBe(false);
  expect(
    shouldAttemptRosterSeed({
      canWrite: true,
      isAuthenticated: false,
      peerUserId: "peer",
    }),
  ).toBe(false);
  for (const peerUserId of [null, "", "   "]) {
    expect(
      shouldAttemptRosterSeed({
        canWrite: true,
        isAuthenticated: true,
        peerUserId,
      }),
    ).toBe(false);
  }
});

test("attemptPeerRosterSeed retries ordinary failures but preserves integrity failures", async () => {
  const fixture = fakeRosterSeedActions({ directoryAndGroups: null });
  const transient = new Error("directory is not ready");
  const integrity = new KeyingVerificationError(
    "equivocation",
    "peer identity changed",
  );
  const logged: unknown[] = [];
  const logError = (_message: string, error: unknown) => logged.push(error);

  await expect(
    attemptPeerRosterSeed(
      {
        ...fixture.actions,
        loadDirectoryAndGroups: async () => {
          throw transient;
        },
      },
      "peer",
      "Peer 2",
      logError,
    ),
  ).resolves.toBe("unsettled");
  expect(logged).toEqual([transient]);

  await expect(
    attemptPeerRosterSeed(
      {
        ...fixture.actions,
        loadDirectoryAndGroups: async () => {
          throw integrity;
        },
      },
      "peer",
      "Peer 2",
      logError,
    ),
  ).rejects.toBe(integrity);
  expect(logged).toEqual([transient]);
});

// #3360: the demo loops gave up after ten failures of any kind, so a run of
// refusals behind another tab's transaction ended the peer bootstrap.
test("a roster seed refused as busy is retried in place, then reported as busy", async () => {
  const fixture = fakeRosterSeedActions({ directoryAndGroups: null });
  const logged: unknown[] = [];
  let loads = 0;
  await expect(
    attemptPeerRosterSeed(
      {
        ...fixture.actions,
        loadDirectoryAndGroups: async () => {
          loads += 1;
          throw new Error(DATABASE_TRANSACTION_BUSY_MESSAGE);
        },
      },
      "peer",
      "Peer 2",
      (_message, error) => logged.push(error),
    ),
  ).resolves.toBe("busy");
  expect(loads).toBe(DATABASE_BUSY_RUN_LIMIT);
  expect(logged).toHaveLength(1);
});

test("a busy refusal spends none of a demo loop's attempts", () => {
  expect(
    demoAttemptsAfterFailure(3, new Error(DATABASE_TRANSACTION_BUSY_MESSAGE)),
  ).toBe(3);
  expect(demoAttemptsAfterFailure(3, new Error("offline"))).toBe(4);
});
