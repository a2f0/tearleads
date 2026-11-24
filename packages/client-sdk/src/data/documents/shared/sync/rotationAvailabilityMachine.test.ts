import { expect, test } from "bun:test";
import { MAX_LORO_RUNTIME_ATTEMPTS } from "./loroRuntimeFailureLedger";
import {
  currentRotationAvailability,
  MAX_ROTATION_DEATHS,
  ROTATION_AVAILABLE,
  type RotationAvailability,
  transitionRotationAvailability,
} from "./rotationAvailabilityMachine";

const JUDGED = { documentId: "doc", judge: "judge" };
const rebuilt = { ...JUDGED, type: "rotationRebuilt" } as const;
/** A window of several updates, whose death names none of them. */
const SEVERAL = ["first", "second"];

function dieTimes(
  times: number,
  from: RotationAvailability = ROTATION_AVAILABLE,
  suspects: readonly string[] = SEVERAL,
): RotationAvailability {
  let state = from;
  for (let death = 0; death < times; death += 1) {
    state = transitionRotationAvailability(state, {
      ...JUDGED,
      suspects,
      type: "rotationDied",
    });
  }
  return state;
}

// VoidUpdateProgress models both limits as its one MaxAttempts.
test("a rotation stops after as many deaths as void an update", () => {
  expect(MAX_ROTATION_DEATHS).toBe(MAX_LORO_RUNTIME_ATTEMPTS);
});

test("rotation deaths below the limit leave the device rotating", () => {
  expect(dieTimes(MAX_ROTATION_DEATHS - 1)).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS - 1,
    status: "dying",
  });
});

test("the limit's death makes rotation unavailable under that judge", () => {
  expect(dieTimes(MAX_ROTATION_DEATHS)).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    status: "unavailable",
  });
});

// A rotation started before the limit can still die once it is reached.
test("a death once rotation is unavailable changes nothing", () => {
  expect(dieTimes(1, dieTimes(MAX_ROTATION_DEATHS))).toEqual(
    dieTimes(MAX_ROTATION_DEATHS),
  );
});

test("a completed rebuild clears deaths below the limit, not unavailability", () => {
  expect(
    transitionRotationAvailability(dieTimes(MAX_ROTATION_DEATHS - 1), rebuilt),
  ).toEqual(ROTATION_AVAILABLE);
  const unavailable = dieTimes(MAX_ROTATION_DEATHS);
  expect(transitionRotationAvailability(unavailable, rebuilt)).toEqual(
    unavailable,
  );
});

test("a new judge or server document starts over", () => {
  const unavailable = dieTimes(MAX_ROTATION_DEATHS);
  for (const current of [
    { ...JUDGED, judge: "newer" },
    { ...JUDGED, documentId: "rebound" },
  ]) {
    expect(currentRotationAvailability(unavailable, current)).toEqual(
      ROTATION_AVAILABLE,
    );
    expect(
      transitionRotationAvailability(unavailable, {
        ...current,
        suspects: SEVERAL,
        type: "rotationDied",
      }),
    ).toEqual({ ...current, deaths: 1, status: "dying" });
  }
  expect(currentRotationAvailability(unavailable, JUDGED)).toEqual(unavailable);
});

/** Rebuilds that left out the update the deaths came to rest on. */
const proven = {
  ...JUDGED,
  leftOut: ["alone"],
  type: "rotationProven",
} as const;
const diverged = {
  ...JUDGED,
  leftOut: ["alone"],
  type: "rotationDiverged",
} as const;
const leavingOut = () =>
  dieTimes(1, dieTimes(MAX_ROTATION_DEATHS - 1), ["alone"]);

// The limit's death reading one update alone may be that update's, whose
// span claimed counters the device holds: the next rebuild leaves it out,
// and a death in that rebuild is the rebuild's own.
test("the limit's death alone on one update leaves that update out", () => {
  expect(leavingOut()).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    leftOut: "alone",
    status: "leavingOut",
  });
  expect(dieTimes(1, leavingOut(), ["other"])).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS + 1,
    status: "unavailable",
  });
});

// Left out, the rebuild equalled the live document, which never held the
// update: rebuilds keep leaving it out, and their deaths count anew.
test("a rebuild without the update that proves keeps leaving it out", () => {
  // Outliving the pull decides nothing: the exact-history check does.
  expect(transitionRotationAvailability(leavingOut(), rebuilt)).toEqual(
    leavingOut(),
  );
  const leftOut = transitionRotationAvailability(leavingOut(), proven);
  expect(leftOut).toEqual({
    ...JUDGED,
    deaths: 0,
    leftOut: "alone",
    status: "leftOut",
  });
  expect(transitionRotationAvailability(leftOut, rebuilt)).toBe(leftOut);
  expect(transitionRotationAvailability(leftOut, proven)).toBe(leftOut);
  for (const state of [ROTATION_AVAILABLE, dieTimes(1)]) {
    expect(transitionRotationAvailability(state, proven)).toBe(state);
  }
  const dying = dieTimes(MAX_ROTATION_DEATHS - 1, leftOut, ["alone"]);
  expect(dying).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS - 1,
    leftOut: "alone",
    status: "leftOut",
  });
  expect(transitionRotationAvailability(dying, rebuilt)).toEqual(leftOut);
  // Only one update is left out: the limit then stops this device.
  expect(dieTimes(1, dying, ["other"])).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    status: "unavailable",
  });
});

// Left out, the rebuild still differs from the live document, which holds
// the update: the deaths were the rebuild's. Any other divergence fails
// that rotation alone.
test("only the rebuild trying the update's absence stops rotation by diverging", () => {
  expect(transitionRotationAvailability(leavingOut(), diverged)).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    status: "unavailable",
  });
  // A rebuild that did not leave the update out decides nothing.
  for (const event of [
    { ...diverged, leftOut: [] },
    { ...proven, leftOut: ["other"] },
  ]) {
    expect(transitionRotationAvailability(leavingOut(), event)).toEqual(
      leavingOut(),
    );
  }
  const leftOut = transitionRotationAvailability(leavingOut(), proven);
  for (const state of [ROTATION_AVAILABLE, dieTimes(1), leftOut]) {
    expect(transitionRotationAvailability(state, diverged)).toBe(state);
  }
});
