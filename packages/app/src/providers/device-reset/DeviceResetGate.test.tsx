import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { DeviceResetGate } from "./DeviceResetGate";
import { requestDeviceReset } from "./deviceReset";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

function requestReset(): void {
  requestDeviceReset(localStorage, () => {});
}

test("without a reset request the app renders on the first render", () => {
  let resets = 0;
  const view = render(
    <DeviceResetGate
      completeReset={async () => {
        resets += 1;
      }}
    >
      <p>app</p>
    </DeviceResetGate>,
  );

  expect(view.getByText("app")).toBeTruthy();
  expect(resets).toBe(0);
});

test("a requested reset holds the app back until the wipe finishes", async () => {
  requestReset();
  const wipe = Promise.withResolvers<void>();
  const view = render(
    <DeviceResetGate completeReset={() => wipe.promise}>
      <p>app</p>
    </DeviceResetGate>,
  );

  expect(view.getByRole("status").textContent).toContain(
    "Resetting this device",
  );
  expect(view.queryByText("app")).toBeNull();

  await act(async () => wipe.resolve());

  expect(view.getByText("app")).toBeTruthy();
});

test("another page's reset reloads this one into a notice instead of the app", async () => {
  const reload = spyOn(window.location, "reload").mockImplementation(() => {});
  const otherTab = new BroadcastChannel("tearleads.device-reset");
  try {
    const before = render(
      <DeviceResetGate completeReset={async () => {}}>
        <p>app</p>
      </DeviceResetGate>,
    );
    sessionStorage.setItem("tearleads.documents.session-peer-seed", "7");
    // This page's own request reloads it through its own path; its broadcast
    // is for the other pages and is delivered here first.
    requestReset();
    otherTab.postMessage("other-page");

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(reload).toHaveBeenCalledTimes(1);
    before.unmount();

    // The reloaded page.
    const after = render(
      <DeviceResetGate completeReset={async () => {}}>
        <p>app</p>
      </DeviceResetGate>,
    );
    expect(after.getByRole("status").textContent).toContain(
      "This device was reset in another tab or window.",
    );
    expect(after.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(after.queryByText("app")).toBeNull();
    // What the tab kept for itself predates the reset.
    expect(sessionStorage.length).toBe(0);
  } finally {
    otherTab.close();
    reload.mockRestore();
  }
});

test("a failed reset reports why and never renders the app", async () => {
  requestReset();
  const view = render(
    <DeviceResetGate
      completeReset={async () => {
        throw new Error('Could not remove "tearleads-sqlite" from OPFS.');
      }}
    >
      <p>app</p>
    </DeviceResetGate>,
  );

  expect(
    (await view.findByRole("alert")).textContent?.includes(
      'Could not remove "tearleads-sqlite" from OPFS.',
    ),
  ).toBe(true);
  expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(view.queryByText("app")).toBeNull();
});
