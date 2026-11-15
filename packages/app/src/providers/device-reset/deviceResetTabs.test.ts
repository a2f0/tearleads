import { afterEach, expect, test } from "bun:test";
import { installFakeLockManager } from "../../../test/helpers/fakeLockManager";
import {
  isDeviceResetRequested,
  requestDeviceReset,
  runRequestedDeviceReset,
} from "./deviceReset";
import { holdAppPageLock } from "./deviceResetTabs";

afterEach(() => {
  localStorage.clear();
});

test("a wipe waits for every page with the app mounted, so their late writes are wiped too", async () => {
  const locks = installFakeLockManager();
  try {
    requestDeviceReset(localStorage, () => {});
    // Another page still has the app mounted.
    const unloadPeer = holdAppPageLock(() => {});

    const reset = runRequestedDeviceReset(undefined);
    await locks.queued;
    // A write the peer had in flight lands while it is still mounted.
    localStorage.setItem("tearleads.local-session:tearleads.app:old", "late");
    expect(isDeviceResetRequested()).toBe(true);

    unloadPeer();
    await reset;

    expect(
      localStorage.getItem("tearleads.local-session:tearleads.app:old"),
    ).toBeNull();
    expect(isDeviceResetRequested()).toBe(false);
  } finally {
    locks.restore();
  }
});
