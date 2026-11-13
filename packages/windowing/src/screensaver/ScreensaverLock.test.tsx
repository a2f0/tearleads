import { afterEach, expect, jest, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
} from "@testing-library/react";
import {
  type ScreensaverControls,
  ScreensaverProvider,
  useScreensaver,
} from "./ScreensaverProvider";
import type { ScreensaverLock } from "./screensaverLock";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function mount(lock: ScreensaverLock) {
  let controls: ScreensaverControls;
  function Host() {
    controls = useScreensaver();
    return (
      <button type="button" onClick={controls.start}>
        Start
      </button>
    );
  }
  const scene = (currentLock?: ScreensaverLock) => (
    <ScreensaverProvider
      screensaver={() => <p>animation</p>}
      lock={currentLock}
    >
      <Host />
    </ScreensaverProvider>
  );
  const view = render(scene(lock));
  return {
    ...view,
    start: () => act(() => controls.start()),
    stop: () => act(() => controls.stop()),
    removeLock: () => view.rerender(scene()),
  };
}

function wake() {
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyUp(window, { key: "Escape" });
  act(() => jest.runAllTimers());
}

async function submit(view: RenderResult, pin: string) {
  fireEvent.change(view.getByLabelText("PIN code"), { target: { value: pin } });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Unlock" }));
  });
}

test("Escape and stop cannot bypass a configured PIN; wrong PIN keeps the page locked", async () => {
  jest.useFakeTimers();
  let locked = false;
  const view = mount({
    lock: () => {
      locked = true;
    },
    unlock: async (pin) => {
      if (pin !== "824913") return false;
      locked = false;
      return true;
    },
  });
  const start = view.getByRole("button", { name: "Start" });
  start.focus();
  view.start();
  expect(locked).toBe(true);
  wake();
  expect(view.getByLabelText("PIN code")).toBeTruthy();
  expect(document.body.inert).toBe(true);
  view.stop();
  wake();
  expect(view.getByLabelText("PIN code")).toBeTruthy();
  await submit(view, "000000");
  expect(locked).toBe(true);
  expect(view.getByRole("alert").textContent).toContain("incorrect");
  expect(document.body.inert).toBe(true);
  await submit(view, "824913");
  act(() => jest.runAllTimers());
  expect(locked).toBe(false);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.body.inert).toBe(false);
  expect(document.activeElement).toBe(start);
});

test("removing lock props and native dialog close cannot remove the session's PIN gate", () => {
  jest.useFakeTimers();
  const view = mount({ lock: () => {}, unlock: async () => false });
  view.start();
  view.removeLock();
  const dialog = view.getByRole("dialog") as HTMLDialogElement;
  act(() => {
    dialog.close();
    dialog.dispatchEvent(new Event("close"));
  });
  act(() => jest.runAllTimers());
  expect(view.getByLabelText("PIN code")).toBeTruthy();
  const gate = view.getByRole("dialog") as HTMLDialogElement;
  act(() => {
    gate.close();
    gate.dispatchEvent(new Event("close"));
  });
  expect(gate.open).toBe(true);
  expect(document.body.inert).toBe(true);
});

test("verification failure stays locked and an unmounted attempt cannot finish a later session", async () => {
  jest.useFakeTimers();
  const pending = Promise.withResolvers<boolean>();
  let attempts = 0;
  const lock = {
    lock: () => {},
    unlock: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("private verifier detail");
      return pending.promise;
    },
  };
  const first = mount(lock);
  first.start();
  wake();
  await submit(first, "824913");
  expect(first.getByRole("alert").textContent).toContain("Unable");
  expect(first.getByRole("alert").textContent).not.toContain("private");
  await submit(first, "824913");
  expect(
    first.getByRole("button", { name: "Unlocking…" }).hasAttribute("disabled"),
  ).toBe(true);
  first.unmount();
  const second = mount(lock);
  second.start();
  wake();
  await act(async () => pending.resolve(true));
  expect(second.getByLabelText("PIN code")).toBeTruthy();
  expect(document.body.inert).toBe(true);
});
