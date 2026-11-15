import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { DeviceResetGate } from "./DeviceResetGate";
import { requestDeviceReset } from "./deviceReset";

afterEach(() => {
  cleanup();
  localStorage.clear();
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

test("a reset requested in another tab unmounts the app and offers a reload", async () => {
  let unmounted = false;
  function App() {
    useEffect(
      () => () => {
        unmounted = true;
      },
      [],
    );
    return <p>app</p>;
  }
  const view = render(
    <DeviceResetGate completeReset={async () => {}}>
      <App />
    </DeviceResetGate>,
  );
  const otherTab = new BroadcastChannel("tearleads.device-reset");

  try {
    // This page's own request reloads it; its broadcast is for other tabs.
    requestReset();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(view.getByText("app")).toBeTruthy();

    otherTab.postMessage("other-page");

    expect(
      (await view.findByRole("status")).textContent?.includes(
        "This device was reset in another tab or window.",
      ),
    ).toBe(true);
    expect(unmounted).toBe(true);
    expect(view.getByRole("button", { name: "Reload" })).toBeTruthy();
  } finally {
    otherTab.close();
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
