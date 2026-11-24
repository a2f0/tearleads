import { expect, test } from "bun:test";
import {
  MAX_ROSTER_PROFILE_PULL_FAILURES,
  recordRosterProfilePull,
  selectRosterProfilePulls,
} from "./rosterProfilePullLedger";

const pull = (index: number) => ({
  profileDocumentId: `profile-document-${index}`,
  userId: `user-${index}`,
});
const ids = (pulls: ReadonlyArray<ReturnType<typeof pull>>) =>
  pulls.map((entry) => entry.userId);

test("profiles that failed yield their places to the rest, then wait", () => {
  const sdk = {};
  const pulls = [pull(0), pull(1), pull(2)];
  expect(ids(selectRosterProfilePulls(sdk, pulls, 2))).toEqual([
    "user-0",
    "user-1",
  ]);

  recordRosterProfilePull(sdk, pull(0), false);
  expect(ids(selectRosterProfilePulls(sdk, pulls, 2))).toEqual([
    "user-1",
    "user-2",
  ]);
  expect(ids(selectRosterProfilePulls(sdk, pulls, 3))).toEqual([
    "user-1",
    "user-2",
    "user-0",
  ]);

  for (let failure = 1; failure < MAX_ROSTER_PROFILE_PULL_FAILURES; failure++) {
    recordRosterProfilePull(sdk, pull(0), false);
  }
  expect(ids(selectRosterProfilePulls(sdk, pulls, 3))).toEqual([
    "user-1",
    "user-2",
  ]);
  // Another SDK (a new session or identity) starts with a clean ledger.
  expect(ids(selectRosterProfilePulls({}, pulls, 3))).toEqual([
    "user-0",
    "user-1",
    "user-2",
  ]);
});

test("a completed pull clears earlier failures", () => {
  const sdk = {};
  const pulls = [pull(0), pull(1)];
  recordRosterProfilePull(sdk, pull(0), false);
  recordRosterProfilePull(sdk, pull(0), true);
  expect(ids(selectRosterProfilePulls(sdk, pulls, 1))).toEqual(["user-0"]);
});

test("a replaced profile pointer starts without the old profile's failures", () => {
  const sdk = {};
  for (let failure = 0; failure < MAX_ROSTER_PROFILE_PULL_FAILURES; failure++) {
    recordRosterProfilePull(sdk, pull(0), false);
  }
  const replaced = { ...pull(0), profileDocumentId: "profile-document-new" };
  expect(ids(selectRosterProfilePulls(sdk, [replaced], 1))).toEqual(["user-0"]);
});
