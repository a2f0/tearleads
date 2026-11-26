import { expect, test } from "bun:test";
import { mapLanesBounded } from "./boundedLaneWork";

/** A unit of work that settles only when the test releases it. */
function gate() {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

test("lanes run at most the bound at once and keep their order", async () => {
  const lanes = Array.from({ length: 32 }, (_, index) => index);
  const gates = lanes.map(gate);
  let inFlight = 0;
  let mostInFlight = 0;
  const started: number[] = [];
  const mapped = mapLanesBounded(lanes, 4, async (lane) => {
    started.push(lane);
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    await gates[lane]?.opened;
    inFlight -= 1;
    return `page-${lane}`;
  });

  await Promise.resolve();
  expect(started).toEqual([0, 1, 2, 3]);
  // Release out of order: a later lane finishing first keeps its own slot.
  for (const lane of [...lanes].reverse()) gates[lane]?.release();

  expect(await mapped).toEqual(lanes.map((lane) => `page-${lane}`));
  expect(mostInFlight).toBe(4);
});

test("fewer lanes than the bound start together, and none lists nothing", async () => {
  const started: string[] = [];
  expect(
    await mapLanesBounded(["a", "b"], 4, async (lane) => {
      started.push(lane);
      return lane.toUpperCase();
    }),
  ).toEqual(["A", "B"]);
  expect(started).toEqual(["a", "b"]);
  expect(await mapLanesBounded([], 4, async () => "never")).toEqual([]);
});

test("a failed lane fails the batch and starts no further lane", async () => {
  const lanes = Array.from({ length: 12 }, (_, index) => index);
  const held = gate();
  const started: number[] = [];
  const failure = new Error("lane failed");
  const mapped = mapLanesBounded(lanes, 4, async (lane) => {
    started.push(lane);
    if (lane === 1) throw failure;
    await held.opened;
    return lane;
  });

  await expect(mapped).rejects.toBe(failure);
  // The lanes in flight beside the failure finish; none after them starts.
  held.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual([0, 1, 2, 3]);
});

test("a bound that would start no lane is refused", async () => {
  for (const concurrency of [0, -1, 1.5, Number.NaN]) {
    await expect(
      mapLanesBounded(["a"], concurrency, async (lane) => lane),
    ).rejects.toBeInstanceOf(RangeError);
  }
});
