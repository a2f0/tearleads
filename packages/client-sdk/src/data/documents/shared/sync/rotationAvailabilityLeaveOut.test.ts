import { expect, test } from "bun:test";
import {
  MAX_ROTATION_DEATHS,
  MAX_ROTATION_LEFT_OUT,
  ROTATION_AVAILABLE,
  type RotationAvailability,
  rotationIsolates,
  rotationLeftOut,
  transitionRotationAvailability,
} from "./rotationAvailabilityMachine";

const JUDGED = { documentId: "doc", judge: "judge" };
const rebuilt = { ...JUDGED, type: "rotationRebuilt" } as const;
/** A window of several updates, whose death names none of them. */
const SEVERAL = ["first", "second"];

function die(
  from: RotationAvailability,
  suspects: readonly string[],
  times = 1,
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

const proven = (leftOut: readonly string[]) =>
  ({ ...JUDGED, leftOut, type: "rotationProven" }) as const;
const diverged = (leftOut: readonly string[]) =>
  ({ ...JUDGED, leftOut, type: "rotationDiverged" }) as const;

/** The limit reached with its last death reading `alone`, from `from`. */
const leavingOut = (
  alone = "alone",
  from: RotationAvailability = ROTATION_AVAILABLE,
) => die(die(from, SEVERAL, MAX_ROTATION_DEATHS - 1), [alone]);

// The limit's death reading one update alone may be that update's, whose
// span claimed counters the device holds: the next rebuild leaves it out,
// and a death in that rebuild is the rebuild's own.
test("the limit's death alone on one update leaves that update out", () => {
  expect(leavingOut()).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    leftOut: [],
    status: "leavingOut",
    trying: "alone",
  });
  expect(rotationLeftOut(leavingOut())).toEqual(["alone"]);
  expect(die(leavingOut(), ["other"])).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    status: "unavailable",
  });
  // Outliving the pull decides nothing: the exact-history check does.
  expect(transitionRotationAvailability(leavingOut(), rebuilt)).toEqual(
    leavingOut(),
  );
});

// Left out, the rebuild equalled the live document, which never held the
// update: rebuilds keep leaving it out, and their deaths count anew.
test("a rebuild without the update that proves keeps leaving it out", () => {
  // A rebuild that did not leave the update out decides nothing.
  for (const event of [proven([]), proven(["other"]), diverged(["other"])]) {
    expect(transitionRotationAvailability(leavingOut(), event)).toEqual(
      leavingOut(),
    );
  }
  const leftOut = transitionRotationAvailability(
    leavingOut(),
    proven(["alone"]),
  );
  expect(leftOut).toEqual({
    ...JUDGED,
    deaths: 0,
    leftOut: ["alone"],
    status: "leftOut",
  });
  expect(transitionRotationAvailability(leftOut, rebuilt)).toBe(leftOut);
  expect(transitionRotationAvailability(leftOut, proven(["alone"]))).toBe(
    leftOut,
  );
  for (const state of [ROTATION_AVAILABLE, die(ROTATION_AVAILABLE, SEVERAL)]) {
    expect(transitionRotationAvailability(state, proven(["alone"]))).toBe(
      state,
    );
  }
  const dying = die(leftOut, SEVERAL, MAX_ROTATION_DEATHS - 1);
  expect(dying).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS - 1,
    leftOut: ["alone"],
    status: "leftOut",
  });
  expect(transitionRotationAvailability(dying, rebuilt)).toEqual(leftOut);
  expect(die(dying, SEVERAL)).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    status: "unavailable",
  });
});

// A second update whose deaths come to rest on it alone joins the first,
// up to a bound: past it, the device leaves rotation to other members.
test("left-out updates gather up to the bound", () => {
  const first = transitionRotationAvailability(leavingOut(), proven(["alone"]));
  const second = leavingOut("second", first);
  expect(second).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    leftOut: ["alone"],
    status: "leavingOut",
    trying: "second",
  });
  expect(rotationLeftOut(second)).toEqual(["alone", "second"]);
  // The new update alone does not decide: the rebuild left out both.
  expect(transitionRotationAvailability(second, proven(["second"]))).toBe(
    second,
  );
  expect(
    transitionRotationAvailability(second, proven(["alone", "second"])),
  ).toEqual({
    ...JUDGED,
    deaths: 0,
    leftOut: ["alone", "second"],
    status: "leftOut",
  });

  const full: RotationAvailability = {
    ...JUDGED,
    deaths: 0,
    leftOut: Array.from({ length: MAX_ROTATION_LEFT_OUT }, (_, i) => `u${i}`),
    status: "leftOut",
  };
  expect(leavingOut("one-more", full)).toEqual({
    ...JUDGED,
    deaths: MAX_ROTATION_DEATHS,
    status: "unavailable",
  });
});

// Left out, the rebuild still differs from the live document, which holds
// the update: the deaths were the rebuild's. A device that comes to hold an
// update it once proved it never held reads them all again.
test("divergence stops a trying rebuild and restarts a proven one", () => {
  expect(
    transitionRotationAvailability(leavingOut(), diverged(["alone"])),
  ).toEqual({ ...JUDGED, deaths: MAX_ROTATION_DEATHS, status: "unavailable" });
  const leftOut = transitionRotationAvailability(
    leavingOut(),
    proven(["alone"]),
  );
  expect(transitionRotationAvailability(leftOut, diverged(["alone"]))).toBe(
    ROTATION_AVAILABLE,
  );
  expect(transitionRotationAvailability(leftOut, diverged([]))).toBe(leftOut);
  const dying = die(ROTATION_AVAILABLE, SEVERAL);
  for (const state of [ROTATION_AVAILABLE, dying]) {
    expect(transitionRotationAvailability(state, diverged([]))).toBe(state);
  }
});

// Deaths standing against the rotation make it read one update a page, so
// each further death names one update whatever a sync pull cleared.
test("a rotation isolates while deaths stand against it", () => {
  const leftOut = transitionRotationAvailability(
    leavingOut(),
    proven(["alone"]),
  );
  expect(
    [
      ROTATION_AVAILABLE,
      die(ROTATION_AVAILABLE, SEVERAL),
      leavingOut(),
      leftOut,
      die(leftOut, SEVERAL),
    ].map(rotationIsolates),
  ).toEqual([false, true, true, false, true]);
});
