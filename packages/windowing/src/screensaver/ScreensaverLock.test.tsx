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
import type { ScreensaverPinVerifier } from "./screensaverPinVerifier";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function mount(verifyPin: ScreensaverPinVerifier) {
  let controls: ScreensaverControls;
  function Host() {
    controls = useScreensaver();
    return (
      <button type="button" onClick={controls.start}>
        Start
      </button>
    );
  }
  const scene = (currentVerifier?: ScreensaverPinVerifier) => (
    <ScreensaverProvider
      screensaver={() => <p>animation</p>}
      verifyPin={currentVerifier}
    >
      <Host />
    </ScreensaverProvider>
  );
  const view = render(scene(verifyPin));
  return {
    ...view,
    isActive: () => controls.isActive,
    start: () => act(() => controls.start()),
    stop: () => act(() => controls.stop()),
    removeVerifier: () => view.rerender(scene()),
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

test("wrong PIN and stop cannot reveal the desktop; only the correct PIN exits", async () => {
  jest.useFakeTimers();
  const view = mount(async (pin) => pin === "824913");
  const start = view.getByRole("button", { name: "Start" });
  start.focus();
  expect(view.isActive()).toBe(false);
  view.start();
  expect(view.isActive()).toBe(true);
  wake();
  expect(view.getByLabelText("PIN code")).toBeTruthy();
  expect(document.body.inert).toBe(true);
  expect(view.isActive()).toBe(true);
  view.stop();
  expect(view.getByLabelText("PIN code")).toBeTruthy();
  await submit(view, "000000");
  expect(view.getByRole("alert").textContent).toContain("incorrect");
  expect(document.body.inert).toBe(true);
  expect(view.isActive()).toBe(true);
  await submit(view, "824913");
  act(() => jest.runAllTimers());
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.body.inert).toBe(false);
  expect(document.activeElement).toBe(start);
  expect(view.isActive()).toBe(false);
});

test.each(["button", "Escape"])(
  "cancel by %s resumes artwork without leaking its input or forgetting the PIN",
  (method) => {
    jest.useFakeTimers();
    const view = mount(async () => false);
    view.start();
    wake();
    fireEvent.change(view.getByLabelText("PIN code"), {
      target: { value: "123" },
    });
    if (method === "button") {
      const cancel = view.getByRole("button", { name: "Cancel" });
      fireEvent.pointerDown(cancel);
      fireEvent.pointerUp(cancel);
      fireEvent.click(cancel);
    } else {
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.keyUp(window, { key: "Escape" });
    }
    act(() => jest.advanceTimersByTime(0));
    expect(view.queryByLabelText("PIN code")).toBeNull();
    expect(view.getByText("animation")).toBeTruthy();
    expect(document.body.inert).toBe(true);
    fireEvent.mouseMove(window);
    expect(view.getByText("animation")).toBeTruthy();
    wake();
    expect((view.getByLabelText("PIN code") as HTMLInputElement).value).toBe(
      "",
    );
    expect(document.body.inert).toBe(true);
  },
);

test("removing the verifier and native close cannot remove the captured PIN gate", () => {
  jest.useFakeTimers();
  const view = mount(async () => false);
  view.start();
  view.removeVerifier();
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
  act(() => jest.advanceTimersByTime(0));
  expect(view.getByText("animation")).toBeTruthy();
  expect((view.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
  expect(document.body.inert).toBe(true);
  wake();
  expect(view.getByLabelText("PIN code")).toBeTruthy();
});

test("cancel aborts verification and ignores a late success during a later attempt", async () => {
  jest.useFakeTimers();
  const first = Promise.withResolvers<boolean>();
  const second = Promise.withResolvers<boolean>();
  const signals: AbortSignal[] = [];
  const view = mount(async (_pin, signal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  });
  view.start();
  wake();
  await submit(view, "824913");
  expect(view.isActive()).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  act(() => jest.advanceTimersByTime(0));
  expect(signals[0]?.aborted).toBe(true);
  expect(view.getByText("animation")).toBeTruthy();
  expect(view.isActive()).toBe(true);
  wake();
  await submit(view, "000000");
  await act(async () => first.resolve(true));
  expect(
    view.getByRole("button", { name: "Unlocking…" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(document.body.inert).toBe(true);
  await act(async () => second.resolve(false));
  expect(view.getByRole("alert").textContent).toContain("incorrect");
});

test("errors stay private and unmount aborts pending verification", async () => {
  jest.useFakeTimers();
  const pending = Promise.withResolvers<boolean>();
  let currentSignal: AbortSignal | undefined;
  let attempts = 0;
  const view = mount(async (_pin, signal) => {
    currentSignal = signal;
    if (++attempts === 1) throw new Error("private verifier detail");
    return pending.promise;
  });
  view.start();
  wake();
  await submit(view, "824913");
  expect(view.getByRole("alert").textContent).toContain("Unable");
  expect(view.getByRole("alert").textContent).not.toContain("private");
  await submit(view, "824913");
  view.unmount();
  expect(currentSignal?.aborted).toBe(true);
  const next = mount(async () => false);
  next.start();
  wake();
  await act(async () => pending.resolve(true));
  expect(next.getByLabelText("PIN code")).toBeTruthy();
  expect(document.body.inert).toBe(true);
});
