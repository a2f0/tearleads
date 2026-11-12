import { afterEach, expect, jest, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import * as windowing from "../index";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function renderHost(gracePeriodMs?: number) {
  let controls: windowing.ScreensaverControls | undefined;
  function Host() {
    controls = windowing.useScreensaver();
    return (
      <button type="button" onClick={controls.start}>
        Start
      </button>
    );
  }
  function Plugin() {
    return <p>custom animation</p>;
  }
  const view = render(
    <windowing.ScreensaverProvider
      screensaver={Plugin}
      {...(gracePeriodMs === undefined ? {} : { gracePeriodMs })}
    >
      <Host />
    </windowing.ScreensaverProvider>,
  );
  return {
    ...view,
    controls: () => {
      if (!controls) throw new Error("Host not mounted");
      return controls;
    },
  };
}

test("consumes input during the default grace period and dismisses after it", () => {
  jest.useFakeTimers();
  const view = renderHost();
  act(() => view.controls().start());
  expect(fireEvent.click(window)).toBe(false);
  expect(view.controls().isActive).toBe(true);
  act(() => jest.advanceTimersByTime(1999));
  fireEvent.click(window);
  expect(view.controls().isActive).toBe(true);
  act(() => jest.advanceTimersByTime(1));
  expect(fireEvent.click(window)).toBe(false);
  expect(view.controls().isActive).toBe(false);
});

test("Escape exits during grace and its key sequence cannot reach host shortcuts", () => {
  jest.useFakeTimers();
  const view = renderHost();
  let leaked = 0;
  const listener = () => {
    leaked += 1;
  };
  document.addEventListener("keydown", listener);
  document.addEventListener("keyup", listener);
  try {
    act(() => view.controls().start());
    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(false);
    expect(view.controls().isActive).toBe(false);
    expect(
      fireEvent.keyDown(document.body, { key: "Escape", repeat: true }),
    ).toBe(false);
    expect(fireEvent.keyUp(document.body, { key: "Escape" })).toBe(false);
    expect(leaked).toBe(0);
    act(() => jest.runAllTimers());
    fireEvent.keyDown(document.body, { key: "x" });
    expect(leaked).toBe(1);
  } finally {
    document.removeEventListener("keydown", listener);
    document.removeEventListener("keyup", listener);
  }
});

test.each(["pointerdown", "mousedown", "touchstart"])(
  "dismisses on %s without leaking the release or click",
  (type) => {
    jest.useFakeTimers();
    const view = renderHost(10);
    act(() => view.controls().start());
    act(() => jest.advanceTimersByTime(10));
    const target = view.getByRole("button", { name: "Start" });
    expect(
      fireEvent(target, new Event(type, { bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(view.controls().isActive).toBe(false);
    for (const tail of ["pointerup", "mouseup", "touchend", "click"]) {
      expect(
        fireEvent(target, new Event(tail, { bubbles: true, cancelable: true })),
      ).toBe(false);
    }
    expect(view.controls().isActive).toBe(false);
    act(() => jest.runAllTimers());
    fireEvent.click(target);
    expect(view.controls().isActive).toBe(true);
  },
);

test.each(["mousemove", "pointermove", "wheel", "contextmenu"])(
  "consumes %s through grace then dismisses",
  (type) => {
    jest.useFakeTimers();
    const view = renderHost(10);
    act(() => view.controls().start());
    expect(fireEvent(window, new Event(type, { cancelable: true }))).toBe(
      false,
    );
    expect(view.controls().isActive).toBe(true);
    act(() => jest.advanceTimersByTime(10));
    expect(fireEvent(window, new Event(type, { cancelable: true }))).toBe(
      false,
    );
    expect(view.controls().isActive).toBe(false);
  },
);

test("keeps the underlying page inert until the dismissing pointer sequence finishes", () => {
  jest.useFakeTimers();
  const view = renderHost(1);
  const button = view.getByRole("button", { name: "Start" });
  button.focus();
  act(() => view.controls().start());
  expect(document.body.inert).toBe(true);
  act(() => jest.advanceTimersByTime(1));
  fireEvent.pointerDown(window);
  expect(view.controls().isActive).toBe(false);
  expect(document.body.inert).toBe(true);
  fireEvent.pointerUp(window);
  fireEvent.click(window);
  act(() => jest.runAllTimers());
  expect(document.body.inert).toBe(false);
  expect(document.activeElement).toBe(button);
});

test("a held modifier cannot leak after the first dismissal key is released", () => {
  jest.useFakeTimers();
  const view = renderHost(1);
  fireEvent.keyDown(window, { key: "Control" });
  act(() => view.controls().start());
  act(() => jest.advanceTimersByTime(1));
  fireEvent.keyDown(window, { key: "x" });
  expect(view.controls().isActive).toBe(false);
  expect(fireEvent.keyUp(window, { key: "x" })).toBe(false);
  act(() => jest.runAllTimers());
  expect(document.body.inert).toBe(true);
  expect(fireEvent.keyDown(window, { key: "Control", repeat: true })).toBe(
    false,
  );
  expect(fireEvent.keyUp(window, { key: "Control" })).toBe(false);
  act(() => jest.runAllTimers());
  expect(document.body.inert).toBe(false);
});

test("recovers a modifier held in an iframe from the waking key's modifier flags", () => {
  jest.useFakeTimers();
  const view = renderHost(1);
  act(() => view.controls().start());
  act(() => jest.advanceTimersByTime(1));
  fireEvent.keyDown(window, { key: "x", code: "KeyX", ctrlKey: true });
  fireEvent.keyUp(window, { key: "x", code: "KeyX", ctrlKey: true });
  act(() => jest.runAllTimers());
  expect(document.body.inert).toBe(true);
  expect(
    fireEvent.keyUp(window, {
      key: "Control",
      code: "ControlLeft",
      ctrlKey: false,
    }),
  ).toBe(false);
  act(() => jest.runAllTimers());
  expect(document.body.inert).toBe(false);
});

test("opens a modal dialog in the body, isolates decorative content, and restores focus", () => {
  const view = renderHost();
  const button = view.getByRole("button", { name: "Start" });
  button.focus();
  act(() => view.controls().start());
  const dialog = view.getByRole("dialog", { name: "Screensaver" });
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(
    view.getByText("custom animation").closest("[inert][aria-hidden=true]"),
  ).toBeTruthy();
  act(() => view.controls().stop());
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(button);
});

test("mounts the supplied plugin only between start and stop", () => {
  expect("ScreensaverProvider" in windowing).toBe(true);
  const { ScreensaverProvider, useScreensaver } = windowing;
  let controls: ReturnType<typeof useScreensaver> | undefined;
  let mounts = 0;
  let unmounts = 0;
  function Plugin() {
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return <p>custom animation</p>;
  }
  function Host() {
    controls = useScreensaver();
    return <p>desktop</p>;
  }
  const view = render(
    <ScreensaverProvider screensaver={Plugin}>
      <Host />
    </ScreensaverProvider>,
  );
  expect(mounts).toBe(0);
  expect(controls?.isActive).toBe(false);
  act(() => controls?.start());
  expect(mounts).toBe(1);
  expect(controls?.isActive).toBe(true);
  expect(view.getByText("custom animation")).toBeTruthy();
  act(() => controls?.stop());
  expect(unmounts).toBe(1);
  expect(controls?.isActive).toBe(false);
  expect(view.queryByText("custom animation")).toBeNull();
});
