import { afterEach, expect, mock, test } from "bun:test";

const fixture: {
  listeners: {
    keyboardDidHide?: () => void;
    keyboardDidShow?: () => void;
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

mock.module("@capacitor/keyboard", () => ({ Keyboard: { addListener } }));

const { subscribeCapacitorKeyboardVisibility } = await import(
  "./capacitorKeyboardVisibility"
);

afterEach(() => {
  fixture.listeners = {};
  fixture.removed = 0;
});

test("reports native keyboard show and hide events", async () => {
  const visibility: boolean[] = [];
  const unsubscribe = subscribeCapacitorKeyboardVisibility((visible) => {
    visibility.push(visible);
  });

  fixture.listeners.keyboardDidShow?.();
  fixture.listeners.keyboardDidHide?.();
  expect(visibility).toEqual([true, false]);

  unsubscribe();
  fixture.listeners.keyboardDidShow?.();
  await Promise.resolve();
  expect(visibility).toEqual([true, false]);
  expect(fixture.removed).toBe(2);
});
