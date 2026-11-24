import { expect, test } from "bun:test";
import {
  currentRotationAvailability,
  MAX_ROTATION_DEATHS,
  ROTATION_AVAILABLE,
  type RotationAvailability,
  transitionRotationAvailability,
} from "./rotationAvailabilityMachine";

const JUDGED = { documentId: "doc", judge: "judge" };

function dieTimes(
  times: number,
  from: RotationAvailability = ROTATION_AVAILABLE,
): RotationAvailability {
  let state = from;
  for (let death = 0; death < times; death += 1) {
    state = transitionRotationAvailability(state, {
      ...JUDGED,
      type: "rotationDied",
    });
  }
  return state;
}

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

test("a completed rebuild clears deaths below the limit, not unavailability", () => {
  const rebuilt = { ...JUDGED, type: "rotationRebuilt" } as const;
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
        type: "rotationDied",
      }),
    ).toEqual({ ...current, deaths: 1, status: "dying" });
  }
  expect(currentRotationAvailability(unavailable, JUDGED)).toEqual(unavailable);
});
