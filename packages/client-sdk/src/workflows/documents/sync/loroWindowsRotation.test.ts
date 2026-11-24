import { afterEach, beforeEach, expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import {
  createLoroWindowBench,
  device,
  FIRST,
  honest,
  MAIN,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import {
  createDocumentSyncLoroWindow,
  settleDocumentSyncLoroWindow,
} from "./loroPassWindow";

const bench = createLoroWindowBench();
const { judgeIn, pageLimit, recordedAttempts, rotateIn, rotationDeaths } =
  bench;

beforeEach(async () => {
  await bench.open();
});

afterEach(() => bench.close());

/** The version of a device that has accepted no update. */
async function acceptedNothing(): Promise<string> {
  const empty = await createDocument("accepted-nothing");
  try {
    return encodeVersionVector(empty);
  } finally {
    empty.free();
  }
}

// A rotation rebuilding history this device accepted dies far likelier of
// the rebuild than of an update: the death counts toward the rotation, never
// the update, and the page's updates are read alone from then on (#3194).
test("a death reading accepted history counts toward the rotation and isolates", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await rotateIn(
    host.lifetime("dead"),
    [update],
    update.partialEndVersionVector,
  );
  host.kill("dead");

  await bench.claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await rotationDeaths()).toEqual([{ deaths: 1, status: "dying" }]);
  expect(await pageLimit()).toBe(1);
});

// Tabs rebuilding one document in a browser process that crashes die
// together, so one claim counts one rotation death, as it counts one
// attempt per update.
test("one claim counts at most one rotation death", async () => {
  const host = device();
  const first = await honest(FIRST);
  const second = await honest(SECOND);
  for (const [lifetime, update] of [
    ["dead-first", first.update],
    ["dead-second", second.update],
  ] as const) {
    await rotateIn(
      host.lifetime(lifetime),
      [update],
      update.partialEndVersionVector,
    );
  }
  host.kill("dead-first");
  host.kill("dead-second");

  await bench.claimIn(host.lifetime("next"), MAIN);

  expect(await rotationDeaths()).toEqual([{ deaths: 1, status: "dying" }]);
});

// Raw history also holds updates the device has not accepted, which the
// rotation installs with the rest: a death reading one alone counts toward
// it as a sync pass's would, and the rotation stays available.
test("a death reading an update the device has not accepted counts toward it", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await rotateIn(host.lifetime("dead"), [update], await acceptedNothing());
  host.kill("dead");

  await bench.claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBe(1);
  expect(await rotationDeaths()).toEqual([]);
});

// A rotation window the process outlived read its updates without dying, as
// a sync window does, so its close clears the attempts counted toward them.
test("a rotation window's close clears the attempts of the updates it read", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  for (const lifetime of ["dead-1", "dead-2"]) {
    await judgeIn(host.lifetime(lifetime), [update]);
    host.kill(lifetime);
  }
  const window = createDocumentSyncLoroWindow();
  await rotateIn(
    host.lifetime("survivor"),
    [update],
    update.partialEndVersionVector,
    window,
  );
  expect(await recordedAttempts(FIRST)).toBe(2);

  await settleDocumentSyncLoroWindow(window, null);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await rotationDeaths()).toEqual([]);
});
