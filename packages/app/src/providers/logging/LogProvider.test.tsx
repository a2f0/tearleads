import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { PaneLog } from "../../components/pane/log/PaneLog";
import { LogProvider, useLog } from "./LogProvider";

function LogHarness() {
  const { log, logError } = useLog();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          logError(
            "Failed to bootstrap root container",
            new Error("db unavailable"),
          )
        }
      >
        Record error
      </button>
      <button
        type="button"
        onClick={() => logError(new TypeError("invalid state"))}
      >
        Record raw error
      </button>
      <button
        type="button"
        onClick={() => {
          for (let index = 0; index < 1001; index += 1) {
            log(`Entry ${index}`);
          }
        }}
      >
        Fill log
      </button>
      <PaneLog />
    </>
  );
}

test("renders error log entries in the pane log", () => {
  const view = render(
    <LogProvider>
      <LogHarness />
    </LogProvider>,
  );

  fireEvent.click(view.getByText("Record error"));

  expect(
    view.getByText(
      /ERROR: Failed to bootstrap root container: Error: db unavailable/,
    ),
  ).toBeTruthy();

  view.unmount();
});

test("renders raw Error objects with their type information", () => {
  const view = render(
    <LogProvider>
      <LogHarness />
    </LogProvider>,
  );

  fireEvent.click(view.getByText("Record raw error"));

  expect(view.getByText(/ERROR: TypeError: invalid state/)).toBeTruthy();

  view.unmount();
});

test("renders pane log timestamps with locale-independent milliseconds", () => {
  const timestamp = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();
  const view = render(
    <LogProvider>
      <PaneLog
        trailingEntries={[
          {
            id: "stable-timestamp",
            level: "info",
            timestamp,
            message: "Stable timestamp",
          },
        ]}
      />
    </LogProvider>,
  );

  expect(view.getByText("[03:04:05.006] Stable timestamp")).toBeTruthy();

  view.unmount();
});

test("can hide displayed subsecond precision without changing the log value", () => {
  const timestamp = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();
  const view = render(
    <LogProvider>
      <PaneLog
        hideSubsecondPrecision
        trailingEntries={[
          {
            id: "hidden-subseconds",
            level: "error",
            timestamp,
            message: "Displayed without milliseconds",
          },
        ]}
      />
    </LogProvider>,
  );

  expect(view.getByText("03:04:05")).toBeTruthy();
  expect(view.queryByText(/03:04:05\.006/)).toBeNull();
  expect(view.container.querySelector(".pane-log")?.textContent).toBe(
    "[03:04:05] ERROR: Displayed without milliseconds",
  );

  view.unmount();
});

test("retains only the most recent 1000 log entries", () => {
  const view = render(
    <LogProvider>
      <LogHarness />
    </LogProvider>,
  );

  fireEvent.click(view.getByText("Fill log"));

  expect(view.queryByText(/\] Entry 0$/)).toBeNull();
  expect(view.getByText(/\] Entry 1$/)).toBeTruthy();
  expect(view.getByText(/\] Entry 1000$/)).toBeTruthy();
  expect(view.container.querySelectorAll(".pane-log > div")).toHaveLength(1000);

  view.unmount();
});
