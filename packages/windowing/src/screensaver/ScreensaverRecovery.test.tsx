import { afterEach, expect, jest, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  type ScreensaverControls,
  ScreensaverProvider,
  useScreensaver,
} from "./ScreensaverProvider";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
function renderHost() {
  let controls: ScreensaverControls;
  function Host() {
    controls = useScreensaver();
    return null;
  }
  render(
    <ScreensaverProvider screensaver={() => null} gracePeriodMs={1}>
      <Host />
    </ScreensaverProvider>,
  );
  return { start: () => act(() => controls.start()), controls: () => controls };
}

test("an idle command with a missing keyup cannot poison the next session", () => {
  jest.useFakeTimers();
  const host = renderHost();
  fireEvent.keyDown(window, { key: "Meta", code: "MetaLeft", metaKey: true });
  fireEvent.keyDown(window, { key: "c", code: "KeyC", metaKey: true });
  fireEvent.keyUp(window, { key: "Meta", code: "MetaLeft" });
  host.start();
  act(() => jest.advanceTimersByTime(1));
  fireEvent.mouseMove(window);
  expect(host.controls().isActive).toBe(false);
  expect(document.body.inert).toBe(false);
});

test("Escape recovers a lost release without leaking its own release", () => {
  jest.useFakeTimers();
  const host = renderHost();
  host.start();
  act(() => jest.advanceTimersByTime(1));
  fireEvent.keyDown(window, { key: "x", code: "KeyX" });
  expect(document.body.inert).toBe(true);
  expect(fireEvent.keyDown(window, { key: "Escape", code: "Escape" })).toBe(
    false,
  );
  expect(document.body.inert).toBe(true);
  fireEvent.mouseUp(window);
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(true);
  expect(fireEvent.keyUp(window, { key: "Escape", code: "Escape" })).toBe(
    false,
  );
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(false);
});

test("hidden-page recovery clears a lost release without requiring window blur", () => {
  jest.useFakeTimers();
  const host = renderHost();
  host.start();
  fireEvent.keyDown(window, { key: "Escape" });
  const descriptor = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  try {
    fireEvent(document, new Event("visibilitychange"));
    act(() => jest.advanceTimersByTime(0));
    expect(document.body.inert).toBe(false);
  } finally {
    if (descriptor)
      Object.defineProperty(document, "visibilityState", descriptor);
    else Reflect.deleteProperty(document, "visibilityState");
  }
});

test("Meta release clears a missing ordinary key release during dismissal", () => {
  jest.useFakeTimers();
  const host = renderHost();
  host.start();
  fireEvent.keyDown(window, { key: "Meta", code: "MetaLeft", metaKey: true });
  act(() => jest.advanceTimersByTime(1));
  fireEvent.keyDown(window, { key: "c", code: "KeyC", metaKey: true });
  fireEvent.keyUp(window, { key: "Meta", code: "MetaLeft" });
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(false);
});

test("Meta release preserves Escape until its own release", () => {
  jest.useFakeTimers();
  const host = renderHost();
  host.start();
  fireEvent.keyDown(window, { key: "Meta", code: "MetaLeft", metaKey: true });
  act(() => jest.advanceTimersByTime(1));
  fireEvent.keyDown(window, { key: "Escape", code: "Escape", metaKey: true });
  expect(host.controls().isActive).toBe(false);
  fireEvent.keyUp(window, { key: "Meta", code: "MetaLeft" });
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(true);
  expect(fireEvent.keyUp(window, { key: "Escape", code: "Escape" })).toBe(
    false,
  );
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(false);
});

test("multi-touch dismissal drains until the final contact ends", () => {
  jest.useFakeTimers();
  const host = renderHost();
  host.start();
  act(() => jest.advanceTimersByTime(1));
  const one = new Touch({ identifier: 1, target: document.body });
  const two = new Touch({ identifier: 2, target: document.body });
  fireEvent.touchStart(window, { touches: [one, two] });
  expect(host.controls().isActive).toBe(false);
  fireEvent.touchEnd(window, { touches: [two] });
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(true);
  fireEvent.touchEnd(window, { touches: [] });
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(false);
});

test("movement with an already-held mouse button drains its release", () => {
  jest.useFakeTimers();
  const host = renderHost();
  host.start();
  act(() => jest.advanceTimersByTime(1));
  fireEvent.mouseMove(window, { buttons: 1 });
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(true);
  expect(fireEvent.mouseUp(window, { buttons: 0 })).toBe(false);
  expect(fireEvent.click(window)).toBe(false);
  act(() => jest.advanceTimersByTime(0));
  expect(document.body.inert).toBe(false);
});

test.each([
  ["pointerdown", "pointerup"],
  ["mousedown", "mouseup"],
  ["touchstart", "touchend"],
  ["touchstart", "touchcancel"],
  ["pointerdown", "pointercancel"],
])(
  "a %s begun in grace consumes the later %s and click/context-menu tail",
  (press, release) => {
    jest.useFakeTimers();
    const host = renderHost();
    host.start();
    fireEvent(window, new Event(press, { cancelable: true }));
    expect(host.controls().isActive).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(fireEvent(window, new Event(release, { cancelable: true }))).toBe(
      false,
    );
    expect(host.controls().isActive).toBe(false);
    expect(fireEvent.click(window)).toBe(false);
    expect(fireEvent.contextMenu(window)).toBe(false);
    act(() => jest.advanceTimersByTime(0));
    expect(document.body.inert).toBe(false);
  },
);

test("synthetic touch release works when the browser has no TouchEvent constructor", () => {
  jest.useFakeTimers();
  const host = renderHost();
  host.start();
  act(() => jest.advanceTimersByTime(1));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "TouchEvent");
  Object.defineProperty(globalThis, "TouchEvent", {
    value: undefined,
    configurable: true,
  });
  try {
    fireEvent(window, new Event("touchend", { cancelable: true }));
    expect(host.controls().isActive).toBe(false);
    act(() => jest.advanceTimersByTime(0));
    expect(document.body.inert).toBe(false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "TouchEvent", descriptor);
    else Reflect.deleteProperty(globalThis, "TouchEvent");
  }
});

test("idle scroll observation is passive and active consumption is not", () => {
  const add = spyOn(window, "addEventListener");
  const host = renderHost();
  const wheelOptions = () =>
    add.mock.calls.filter(([type]) => type === "wheel").at(-1)?.[2];
  expect(wheelOptions()).toEqual({ capture: true, passive: true });
  host.start();
  expect(wheelOptions()).toEqual({ capture: true, passive: false });
});
