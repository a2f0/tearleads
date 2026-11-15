import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { installFakeLockManager } from "../../../test/helpers/fakeLockManager";
import { DeviceResetGate } from "./DeviceResetGate";
import { requestDeviceReset } from "./deviceReset";
import { runWithoutAppPages } from "./deviceResetTabs";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

function requestReset(): void {
  requestDeviceReset(localStorage, () => {});
}

test("without a reset request the app renders without waiting on a wipe", () => {
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

test("a page that starts during a wipe mounts the app only once the wipe is done", async () => {
  const locks = installFakeLockManager();
  const wipe = Promise.withResolvers<void>();
  try {
    // Another page is wiping; it cleared the request already but still holds
    // the lock while it finishes.
    const wiping = runWithoutAppPages(new AbortController().signal, () => {
      return wipe.promise;
    });
    const view = render(
      <DeviceResetGate completeReset={async () => {}}>
        <p>app</p>
      </DeviceResetGate>,
    );
    await locks.queued;
    expect(view.queryByText("app")).toBeNull();

    await act(async () => {
      wipe.resolve();
      await wiping;
    });

    expect(view.getByText("app")).toBeTruthy();
  } finally {
    wipe.resolve();
    locks.restore();
  }
});

test("a page that gets its lock while a reset is pending stops at the notice", async () => {
  const locks = installFakeLockManager();
  const otherPage = Promise.withResolvers<void>();
  try {
    const elsewhere = runWithoutAppPages(new AbortController().signal, () => {
      return otherPage.promise;
    });
    const view = render(
      <DeviceResetGate completeReset={async () => {}}>
        <p>app</p>
      </DeviceResetGate>,
    );
    await locks.queued;
    // Another tab requests a reset before this page's lock is granted, and its
    // wipe will then wait for this page.
    requestReset();

    await act(async () => {
      otherPage.resolve();
      await elsewhere;
    });

    expect(view.getByRole("status").textContent).toContain(
      "This device is being reset from another tab or window.",
    );
    expect(view.queryByText("app")).toBeNull();
  } finally {
    otherPage.resolve();
    locks.restore();
  }
});

test("a requested reset holds the app back until the wipe finishes", async () => {
  requestReset();
  const wipe = Promise.withResolvers<void>();
  const view = render(
    <DeviceResetGate
      completeReset={async () => {
        await wipe.promise;
        // The wipe clears localStorage, request included.
        localStorage.clear();
      }}
    >
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
      "This device is being reset from another tab or window.",
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
