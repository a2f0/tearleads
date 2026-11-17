import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, useState } from "react";
import {
  findTopWindow,
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
  defaultWindowAppIds: ["explorer"],
  homeAppId: "notes",
};

const browser = window as typeof window & {
  happyDOM: { setURL: (url: string) => void };
};
const initialUrl = window.location.href;

// Points the browser at a path, as a page load or a history step would.
function setPath(path: string) {
  browser.happyDOM.setURL(`http://localhost${path}`);
}

afterEach(() => {
  cleanup();
  browser.happyDOM.setURL(initialUrl);
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
        onClick={() =>
          create("Notes", 10, 20, EmptyApp, {
            appId: "notes",
            pathSegments: ["note", "n2"],
          })
        }
      >
        Seed Notes at n2
      </button>
      <button
        type="button"
        onClick={() =>
          create("Explorer", 10, 20, EmptyApp, { appId: "explorer" })
        }
      >
        Seed Explorer
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
      <output data-testid="paths">
        {JSON.stringify(
          windows.map(({ appId, pathSegments }) => [appId, pathSegments]),
        )}
      </output>
      <output data-testid="front">
        {findTopWindow(windows, () => true)?.appId}
      </output>
    </>
  );
}

function Harness({
  definition = DEFINITION,
  initialMode = "routed",
  initiallyEnabled = true,
  routeWindowEnabled,
}: {
  definition?: LauncherDefinition;
  initialMode?: NavigationMode;
  initiallyEnabled?: boolean;
  routeWindowEnabled?: boolean;
}) {
  const [mode, setMode] = useState(initialMode);
  const [enabled, setEnabled] = useState(initiallyEnabled);
  return (
    <WindowStateProvider>
      <button
        type="button"
        onClick={() => setMode(mode === "routed" ? "windowed" : "routed")}
      >
        Switch mode
      </button>
      <button type="button" onClick={() => setEnabled(!enabled)}>
        Toggle default window
      </button>
      <LauncherNavigationProvider
        defaultWindowEnabled={enabled}
        definition={definition}
        mode={mode}
        routeWindowEnabled={routeWindowEnabled}
      >
        <WindowProbe />
      </LauncherNavigationProvider>
    </WindowStateProvider>
  );
}

test("entering an empty desktop opens its default without navigating", () => {
  window.history.replaceState({ host: true }, "", "/");
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

test("initial windowed mount opens the configured apps once, in order, in StrictMode", () => {
  const view = render(
    <StrictMode>
      <Harness
        definition={{
          ...DEFINITION,
          defaultWindowAppIds: ["notes", "missing", "explorer", "notes"],
        }}
        initialMode="windowed"
      />
    </StrictMode>,
  );
  expect(JSON.parse(view.getByTestId("windows").textContent ?? "")).toEqual([
    { id: "1", appId: "notes", minimized: false },
    { id: "2", appId: "explorer", minimized: false },
  ]);
  expect(view.getByTestId("front").textContent).toBe("explorer");
});

test("disabled defaults wait until enabled and preserve existing windows", () => {
  const view = render(
    <Harness initialMode="windowed" initiallyEnabled={false} />,
  );
  expect(view.getByTestId("windows").textContent).toBe("[]");
  fireEvent.click(view.getByRole("button", { name: "Toggle default window" }));
  const opened = view.getByTestId("windows").textContent;
  expect(JSON.parse(opened ?? "")).toEqual([
    { id: "1", appId: "explorer", minimized: false },
  ]);
  fireEvent.click(view.getByRole("button", { name: "Toggle default window" }));
  fireEvent.click(view.getByRole("button", { name: "Toggle default window" }));
  expect(view.getByTestId("windows").textContent).toBe(opened);
  fireEvent.click(view.getByRole("button", { name: "Close all" }));
  fireEvent.click(view.getByRole("button", { name: "Toggle default window" }));
  fireEvent.click(view.getByRole("button", { name: "Toggle default window" }));
  expect(view.getByTestId("windows").textContent).toBe("[]");
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

test.each<[ReadonlyArray<string> | undefined]>([
  [undefined],
  [[]],
  [["missing"]],
])("no default is opened for configuration %p", (defaultWindowAppIds) => {
  const view = render(
    <Harness
      definition={{ ...DEFINITION, defaultWindowAppIds }}
      initialMode="windowed"
    />,
  );
  expect(view.getByTestId("windows").textContent).toBe("[]");
  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
  expect(view.getByTestId("windows").textContent).toBe("[]");
});

function readOutput(view: ReturnType<typeof render>, testId: string): unknown {
  return JSON.parse(view.getByTestId(testId).textContent ?? "");
}

test("entering windowed mode opens the URL's app in front of the defaults", () => {
  setPath("/app/notes/note/n1");
  window.history.replaceState({ host: true }, "");
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const historyState = window.history.state;
  expect(window.location.pathname).toBe("/app/notes/note/n1");
  expect(view.getByTestId("windows").textContent).toBe("[]");

  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));

  expect(readOutput(view, "paths")).toEqual([
    ["explorer", null],
    ["notes", ["note", "n1"]],
  ]);
  expect(view.getByTestId("front").textContent).toBe("notes");
  expect(window.location.pathname).toBe("/app/notes/note/n1");
  expect(window.history.state).toEqual(historyState);

  // Closing is respected through rerenders, until the next mode entry, which
  // reads the URL again but finds a desktop that is no longer empty.
  fireEvent.click(view.getByRole("button", { name: "Close all" }));
  fireEvent.click(view.getByRole("button", { name: "Seed Notes" }));
  fireEvent.click(view.getByRole("button", { name: "Seed Notes" }));
  expect(readOutput(view, "paths")).toEqual([
    ["notes", null],
    ["notes", null],
  ]);
  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
  // The foremost Notes window is raised and routed; no window is added.
  expect(readOutput(view, "paths")).toEqual([
    ["notes", null],
    ["notes", ["note", "n1"]],
  ]);
});

test("initial windowed mount opens the URL's app once, after the defaults", () => {
  setPath("/app/explorer");
  const view = render(
    <StrictMode>
      <Harness
        definition={{
          ...DEFINITION,
          defaultWindowAppIds: ["explorer", "notes"],
        }}
        initialMode="windowed"
      />
    </StrictMode>,
  );
  expect(readOutput(view, "paths")).toEqual([
    ["notes", null],
    ["explorer", null],
  ]);
  expect(view.getByTestId("front").textContent).toBe("explorer");
});

test("an app's root URL raises its open window where it is", () => {
  setPath("/app/notes");
  const view = render(<Harness />);
  fireEvent.click(view.getByRole("button", { name: "Seed Notes at n2" }));
  fireEvent.click(view.getByRole("button", { name: "Seed Explorer" }));
  fireEvent.click(view.getByRole("button", { name: "Minimize all" }));

  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));

  expect(readOutput(view, "windows")).toEqual([
    { id: "1", appId: "notes", minimized: false },
    { id: "2", appId: "explorer", minimized: true },
  ]);
  expect(readOutput(view, "paths")).toEqual([
    ["notes", ["note", "n2"]],
    ["explorer", null],
  ]);
  expect(view.getByTestId("front").textContent).toBe("notes");
});

test.each(["/", "/app/missing", "/elsewhere"])(
  "the URL %s names no app to open",
  (path) => {
    setPath(path);
    const view = render(<Harness initialMode="windowed" />);
    expect(readOutput(view, "paths")).toEqual([["explorer", null]]);
  },
);

test("a history step while windowed opens the URL's app", () => {
  const view = render(<Harness initialMode="windowed" />);
  expect(readOutput(view, "paths")).toEqual([["explorer", null]]);

  setPath("/app/notes/note/n3");
  fireEvent.popState(window);
  expect(readOutput(view, "paths")).toEqual([
    ["explorer", null],
    ["notes", ["note", "n3"]],
  ]);

  // The routed shell reads the URL itself, and opens no window for it.
  fireEvent.click(view.getByRole("button", { name: "Switch mode" }));
  fireEvent.click(view.getByRole("button", { name: "Close all" }));
  fireEvent.popState(window);
  expect(view.getByTestId("windows").textContent).toBe("[]");
});

test("a launcher with its route window disabled never opens the URL's app", () => {
  setPath("/app/notes");
  const panes = (leftEnabled: boolean) => (
    <>
      <div data-testid="left">
        <Harness initialMode="windowed" routeWindowEnabled={leftEnabled} />
      </div>
      <div data-testid="right">
        <Harness initialMode="windowed" routeWindowEnabled={!leftEnabled} />
      </div>
    </>
  );
  const view = render(panes(true));
  const paths = (testId: string) =>
    JSON.parse(
      view.getByTestId(testId).querySelector("[data-testid='paths']")
        ?.textContent ?? "",
    );
  expect(paths("left")).toEqual([
    ["explorer", null],
    ["notes", null],
  ]);
  expect(paths("right")).toEqual([["explorer", null]]);

  // The URL belonged to the entry: enabling the other launcher later does
  // not open it there, though a later history step does.
  view.rerender(panes(false));
  expect(paths("right")).toEqual([["explorer", null]]);
  fireEvent.popState(window);
  expect(paths("right")).toEqual([
    ["explorer", null],
    ["notes", null],
  ]);
  expect(paths("left")).toEqual([
    ["explorer", null],
    ["notes", null],
  ]);
});
