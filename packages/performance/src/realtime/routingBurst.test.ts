import { expect, test } from "bun:test";
import { measureRoutingBurst } from "./routingBurst";

test("measureRoutingBurst delivers every covered hint across path lengths and sockets", async () => {
  const rows = await measureRoutingBurst({
    hints: 10,
    pathLengths: [4, 25],
    socketCounts: [1, 5],
  });
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.deliveredFrames).toBe(row.hints * row.sockets);
    expect(row.hintsPerSecond).toBeGreaterThan(0);
  }
});
