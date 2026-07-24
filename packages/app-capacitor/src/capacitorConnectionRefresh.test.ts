import { afterEach, expect, mock, test } from "bun:test";

const fixture: {
  listeners: {
    networkStatusChange?: () => void;
    resume?: () => void;
  };
  removed: number;
} = {
  listeners: {},
  removed: 0,
};

function addListener(
  event: keyof (typeof fixture)["listeners"],
  listener: () => void,
) {
  fixture.listeners[event] = listener;
  return Promise.resolve({
    remove: () => {
      fixture.removed += 1;
      return Promise.resolve();
    },
  });
}

mock.module("@capacitor/app", () => ({ App: { addListener } }));
mock.module("@capacitor/network", () => ({ Network: { addListener } }));

const { subscribeCapacitorConnectionRefresh } = await import(
  "./capacitorConnectionRefresh"
);

afterEach(() => {
  fixture.listeners = {};
  fixture.removed = 0;
});

test("refreshes on native resume and network-path changes", async () => {
  let refreshes = 0;
  const unsubscribe = subscribeCapacitorConnectionRefresh(() => {
    refreshes += 1;
  });

  fixture.listeners.resume?.();
  fixture.listeners.networkStatusChange?.();
  expect(refreshes).toBe(2);

  unsubscribe();
  fixture.listeners.resume?.();
  await Promise.resolve();
  expect(refreshes).toBe(2);
  expect(fixture.removed).toBe(2);
});
