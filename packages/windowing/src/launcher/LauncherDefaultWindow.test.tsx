import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, useState } from "react";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "../window/WindowStateProvider";
import { LauncherNavigationProvider } from "./LauncherNavigationProvider";
import type { LauncherDefinition } from "./launcherDefinition";
import type { NavigationMode } from "./navigationMode";

const EmptyApp = () => null;
const DEFINITION: LauncherDefinition = {
  apps: {
    explorer: { createComponent: () => EmptyApp, title: "Explorer" },
    notes: { createComponent: () => EmptyApp, title: "Notes" },
  },
  defaultWindowAppId: "explorer",
  homeAppId: "notes",
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function WindowProbe() {
  const { windows } = useWindowStateData();
  const { close, create, minimize } = useWindowActions();
  return (
    <>
      <button
        type="button"
        onClick={() => create("Notes", 10, 20, EmptyApp, { appId: "notes" })}
      >
        Seed Notes
      </button>
      <button
        type="button"
        onClick={() => {
          for (const { id } of windows) close(id);
        }}
      >
        Close all
      </button>
      <button
        type="button"
        onClick={() => {
          for (const { id } of windows) minimize(id);
        }}
      >
        Minimize all
      </button>
      <output data-testid="windows">
        {JSON.stringify(
          windows.map(({ id, appId, minimized }) => ({ id, appId, minimized })),
        )}
      </output>
    </>
  );
}

function Harness({
  definition = DEFINITION,
  initialMode = "routed",
}: {
  definition?: LauncherDefinition;
  initialMode?: NavigationMode;
}) {
  const [mode, setMode] = useState(initialMode);
  return (
    <WindowStateProvider>
      <button
        type="button"
        onClick={() => setMode(mode === "routed" ? "windowed" : "routed")}
      >
        Switch mode
      </button>
      <LauncherNavigationProvider definition={definition} mode={mode}>
        <WindowProbe />
      </LauncherNavigationProvider>
    </WindowStateProvider>
  );
}

test("entering an empty desktop opens its default without navigating", () => {
  window.history.replaceState({ host: true }, "", "/app/notes");
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const historyState = window.history.state;
  const pathname = window.location.pathname;
  expect(view.getByTestId("windows").textContent).toBe("[]");

  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));

  expect(JSON.parse(view.getByTestId("windows").textContent ?? "")).toEqual([
    { id: "1", appId: "explorer", minimized: false },
  ]);
  expect(window.location.pathname).toBe(pathname);
  expect(window.history.state).toEqual(historyState);

  // Closing is respected through rerenders, until the next mode entry.
  fireEvent.click(view.getByRole("button", { name: "Close all" }));
  expect(view.getByTestId("windows").textContent).toBe("[]");
  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
  expect(view.getByTestId("windows").textContent).toBe("[]");
  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
  expect(JSON.parse(view.getByTestId("windows").textContent ?? "")).toEqual([
    { id: "2", appId: "explorer", minimized: false },
  ]);
});

test("initial windowed mount opens the configured app once in StrictMode", () => {
  const view = render(
    <StrictMode>
      <Harness
        definition={{ ...DEFINITION, defaultWindowAppId: "notes" }}
        initialMode="windowed"
      />
    </StrictMode>,
  );
  expect(JSON.parse(view.getByTestId("windows").textContent ?? "")).toEqual([
    { id: "1", appId: "notes", minimized: false },
  ]);
});

test.each([false, true])(
  "existing windows are preserved (minimized: %s)",
  (minimized) => {
    const view = render(<Harness />);
    fireEvent.click(view.getByRole("button", { name: "Seed Notes" }));
    if (minimized) {
      fireEvent.click(view.getByRole("button", { name: "Minimize all" }));
    }
    const before = view.getByTestId("windows").textContent;
    fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
    expect(view.getByTestId("windows").textContent).toBe(before);
  },
);

test.each([undefined, "missing"])(
  "no default is opened for configuration %s",
  (defaultWindowAppId) => {
    const view = render(
      <Harness
        definition={{ ...DEFINITION, defaultWindowAppId }}
        initialMode="windowed"
      />,
    );
    expect(view.getByTestId("windows").textContent).toBe("[]");
    fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
    fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
    expect(view.getByTestId("windows").textContent).toBe("[]");
  },
);
