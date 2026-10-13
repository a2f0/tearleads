import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { runBlobTransfer } from "./transferPool";

test("byte transfers share a bounded FIFO pool and release permits on failure", async () => {
  const client = {};
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const work = Array.from({ length: 12 }, (_, index) =>
    runBlobTransfer(client, async () => {
      started.push(index);
      peak = Math.max(peak, ++active);
      try {
        await blocked;
        if (index === 0) throw new Error("transfer failed");
        return index;
      } finally {
        active -= 1;
      }
    }),
  );
  const results = Promise.allSettled(work);
  try {
    await waitFor(() => started.length === 4, "expected four active transfers");
    expect(started).toEqual([0, 1, 2, 3]);
    expect(await runBlobTransfer({}, async () => "independent")).toBe(
      "independent",
    );
  } finally {
    release();
  }
  expect(
    (await results).filter((result) => result.status === "fulfilled"),
  ).toHaveLength(11);
  expect(started).toEqual(Array.from({ length: 12 }, (_, index) => index));
  expect(peak).toBe(4);
  expect(await runBlobTransfer(client, async () => "reused")).toBe("reused");
});
