import {
  afterEach,
  beforeEach,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../shared/domainScope";
import { createDomainScope } from "../shared/domainScope";
import {
  beginDomainSyncUploadLane,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

// Run durations read the monotonic clock; a fixed reading makes them exact.
let nowMs = 0;
let clock: Mock<typeof performance.now>;
let measure: Mock<typeof performance.measure>;

beforeEach(() => {
  nowMs = 1_000;
  clock = spyOn(performance, "now").mockImplementation(() => nowMs);
  measure = spyOn(performance, "measure");
});

afterEach(() => {
  clock.mockRestore();
  measure.mockRestore();
});

function createGate(): { open: () => void; opened: Promise<void> } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function findLane(domainScope: DomainScope, key: string) {
  return getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
    (lane) => lane.key === key,
  );
}

function settle(domainScope: DomainScope): Promise<boolean> {
  return waitForDomainSyncCoordinatorToSettle(domainScope, {
    intervalMs: 1,
    timeoutMs: 1_000,
  });
}

test("each settled run adds its duration, completed or failed", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let gate = createGate();
  let fail = false;
  const lane = coordinator.registerLane("slow", {
    label: "Slow lane",
    onUnexpectedError: () => {},
    run: async () => {
      await gate.opened;
      if (fail) {
        throw new Error("transient");
      }
    },
  });
  expect(findLane(domainScope, "slow")?.runDurations).toBeNull();

  lane.requestSync();
  await waitFor(() => findLane(domainScope, "slow")?.running === true, "run");
  nowMs += 40;
  gate.open();
  expect(await settle(domainScope)).toBe(true);
  expect(findLane(domainScope, "slow")?.runDurations).toEqual({
    count: 1,
    lastMs: 40,
    maxMs: 40,
    totalMs: 40,
  });

  gate = createGate();
  fail = true;
  lane.requestSync();
  await waitFor(() => findLane(domainScope, "slow")?.running === true, "rerun");
  nowMs += 10;
  gate.open();
  expect(await settle(domainScope)).toBe(true);
  const failed = findLane(domainScope, "slow");
  expect(failed?.status).toBe("error");
  expect(failed?.runDurations).toEqual({
    count: 2,
    lastMs: 10,
    maxMs: 40,
    totalMs: 50,
  });
  expect(measure).toHaveBeenCalledTimes(2);
  expect(measure.mock.calls[1]?.[0]).toBe("Sync lane: Slow lane");
  expect(measure.mock.calls[1]?.[1]).toMatchObject({
    detail: {
      devtools: {
        color: "error",
        properties: [
          ["phase", "document"],
          ["outcome", "failed"],
          ["watchdog", "within limit"],
        ],
        track: "Sync lanes",
      },
    },
    end: 1_050,
    start: 1_040,
  });
  coordinator.dispose();
});

test("a watchdog verdict records no duration; the late settle records the real one", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const gate = createGate();
  coordinator
    .registerLane("stuck", { run: () => gate.opened, watchdogMs: 20 })
    .requestSync();

  await waitFor(
    () => findLane(domainScope, "stuck")?.runAbandoned === true,
    "Watchdog never abandoned the run.",
  );
  expect(findLane(domainScope, "stuck")?.status).toBe("error");
  expect(findLane(domainScope, "stuck")?.runDurations).toBeNull();
  expect(measure).not.toHaveBeenCalled();

  nowMs += 125_000;
  gate.open();
  await waitFor(
    () => findLane(domainScope, "stuck")?.status === "complete",
    "Abandoned run never settled.",
  );
  expect(findLane(domainScope, "stuck")?.runDurations).toEqual({
    count: 1,
    lastMs: 125_000,
    maxMs: 125_000,
    totalMs: 125_000,
  });
  expect(measure.mock.calls[0]?.[1]).toMatchObject({
    detail: {
      devtools: {
        properties: [
          ["phase", "document"],
          ["outcome", "completed"],
          ["watchdog", "abandoned"],
        ],
      },
    },
  });
  coordinator.dispose();
});

test("an upload session is timed once and stays off the User Timing tracks", () => {
  const domainScope = createDomainScope();
  const upload = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-1");
  nowMs += 300;
  upload.fail(new Error("part rejected"));
  upload.complete();

  expect(findLane(domainScope, "blob-upload:slot-1")?.runDurations).toEqual({
    count: 1,
    lastMs: 300,
    maxMs: 300,
    totalMs: 300,
  });

  const retry = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-1");
  nowMs += 100;
  retry.complete();
  expect(findLane(domainScope, "blob-upload:slot-1")?.runDurations).toEqual({
    count: 2,
    lastMs: 100,
    maxMs: 300,
    totalMs: 400,
  });
  expect(measure).not.toHaveBeenCalled();
});
