import { expect, test } from "bun:test";
import { Events } from "./events";

test("invalidating access state drops caches through the owning client", () => {
  let invalidations = 0;
  const events = new Events([], () => {
    invalidations += 1;
  });

  events.invalidateAccessState();
  events.invalidateAccessState();

  expect(invalidations).toBe(2);
});
