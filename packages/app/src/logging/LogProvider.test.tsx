import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { PaneLog } from "../components/pane/PaneLog";
import { LogProvider, useLog } from "./LogProvider";

function LogHarness() {
  const { logError } = useLog();

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
    view.getByText(/ERROR: Failed to bootstrap root container: db unavailable/),
  ).toBeTruthy();

  view.unmount();
});
