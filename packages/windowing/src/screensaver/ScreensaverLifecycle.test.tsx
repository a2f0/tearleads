import { afterEach, expect, jest, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import {
  type ScreensaverControls,
  ScreensaverProvider,
  useScreensaver,
} from "./ScreensaverProvider";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function Plugin() {
  return <p>first plugin</p>;
}
function OtherPlugin() {
  return <p>replacement plugin</p>;
}

test("a lost release on window blur does not leave the page inert", () => {
  jest.useFakeTimers();
  let controls: ScreensaverControls | undefined;
  function Host() {
    controls = useScreensaver();
    return null;
  }
  render(
    <ScreensaverProvider screensaver={Plugin}>
      <Host />
    </ScreensaverProvider>,
  );
  act(() => controls?.start());
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.body.inert).toBe(true);
  fireEvent(window, new Event("blur"));
  act(() => jest.runAllTimers());
  expect(document.body.inert).toBe(false);
});

test("stop then start in one batch replaces the plugin and ignores the old timer", () => {
  jest.useFakeTimers();
  let controls: ScreensaverControls | undefined;
  function Host() {
    controls = useScreensaver();
    return <button type="button">focus target</button>;
  }
  const view = render(
    <ScreensaverProvider screensaver={Plugin} gracePeriodMs={50}>
      <Host />
    </ScreensaverProvider>,
  );
  const focusTarget = view.getByRole("button");
  focusTarget.focus();
  act(() => controls?.start());
  const first = view.getByText("first plugin");
  act(() => jest.advanceTimersByTime(40));
  act(() => {
    controls?.stop();
    controls?.start();
  });
  expect(view.getByText("first plugin")).not.toBe(first);
  act(() => jest.advanceTimersByTime(10));
  fireEvent.click(window);
  expect(controls?.isActive).toBe(true);
  act(() => jest.advanceTimersByTime(40));
  fireEvent.click(window);
  expect(controls?.isActive).toBe(false);
  expect(document.activeElement).toBe(focusTarget);
});

test("native cancel exits and native close cannot leave an active provider", () => {
  let controls: ScreensaverControls | undefined;
  function Host() {
    controls = useScreensaver();
    return null;
  }
  const view = render(
    <ScreensaverProvider screensaver={Plugin}>
      <Host />
    </ScreensaverProvider>,
  );
  act(() => controls?.start());
  const dialog = view.getByRole("dialog") as HTMLDialogElement;
  expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(
    false,
  );
  expect(controls?.isActive).toBe(false);
  act(() => controls?.start());
  const next = view.getByRole("dialog") as HTMLDialogElement;
  act(() => {
    next.close();
    next.dispatchEvent(new Event("close"));
  });
  expect(controls?.isActive).toBe(false);
});

test("StrictMode replacement preserves the session and unmount cleans input and timers", () => {
  jest.useFakeTimers();
  let controls: ScreensaverControls | undefined;
  function Host() {
    controls = useScreensaver();
    return <button type="button">host</button>;
  }
  const scene = (screensaver: typeof Plugin) => (
    <StrictMode>
      <ScreensaverProvider screensaver={screensaver} gracePeriodMs={50}>
        <Host />
      </ScreensaverProvider>
    </StrictMode>
  );
  const view = render(scene(Plugin));
  act(() => controls?.start());
  const first = view.getByRole("dialog");
  expect(first.hasAttribute("open")).toBe(true);
  view.rerender(scene(OtherPlugin));
  expect(view.queryByText("first plugin")).toBeNull();
  expect(view.getByText("replacement plugin")).toBeTruthy();
  expect(view.getByRole("dialog")).toBe(first);
  act(() => jest.advanceTimersByTime(50));
  expect(controls?.isActive).toBe(true);
  view.unmount();
  expect(document.querySelector("dialog")).toBeNull();
  act(() => jest.runAllTimers());
  expect(fireEvent.keyDown(window, { key: "x" })).toBe(true);
  expect(fireEvent.click(window)).toBe(true);
});
