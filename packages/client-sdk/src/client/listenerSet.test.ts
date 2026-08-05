import { expect, test } from "bun:test";
import { createListenerSet } from "./listenerSet";

test("notify isolates a throwing subscriber from later subscribers", () => {
  const set = createListenerSet<[string]>();
  const seen: string[] = [];
  set.subscribe(() => {
    throw new Error("first subscriber failed");
  });
  set.subscribe((value) => {
    seen.push(value);
  });

  set.notify("payload");

  expect(seen).toEqual(["payload"]);
});

test("unsubscribe removes exactly the returned listener", () => {
  const set = createListenerSet();
  let first = 0;
  let second = 0;
  const unsubscribe = set.subscribe(() => {
    first += 1;
  });
  set.subscribe(() => {
    second += 1;
  });

  set.notify();
  unsubscribe();
  set.notify();

  expect(first).toBe(1);
  expect(second).toBe(2);
});
