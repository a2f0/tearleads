import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { fakeRosterSeedActions } from "../stores/org-manager/rosterSeed.testUtils";
import {
  attemptPeerRosterSeed,
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
  ).resolves.toBe(false);
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
