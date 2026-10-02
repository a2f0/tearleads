import { fireEvent, type RenderResult, render } from "@testing-library/react";
import { stubLayout } from "./layout.testUtils";
import { Window } from "./Window";
import {
  useWindowActions,
  useWindowStateData,
  type WindowCreateOptions,
  WindowStateProvider,
} from "./WindowStateProvider";

// A desktop for geometry tests: buttons that drive the window state, the
// windows themselves, and a probe that prints the committed geometry.

export function GeometryProbe() {
  const { windows } = useWindowStateData();
  const entry = windows[0];
  return (
    <output aria-label="committed geometry">
      {entry
        ? JSON.stringify({ position: entry.position, size: entry.size })
        : ""}
    </output>
  );
}

function NotesContent() {
  return <p>notes</p>;
}

export function DesktopHarness({ options }: { options: WindowCreateOptions }) {
  const { windows } = useWindowStateData();
  const { create, minimize, restore, setGeometry, toggleMaximize } =
    useWindowActions();
  const first = windows[0];

  return (
    <>
      <button
        type="button"
        onClick={() => create("Notes", 0, 0, NotesContent, options)}
      >
        Open notes
      </button>
      <button
        type="button"
        onClick={() =>
          first &&
          setGeometry(first.id, {
            position: { x: 500, y: 0 },
            size: { height: 100, width: 200 },
          })
        }
      >
        Restore layout
      </button>
      <button
        type="button"
        onClick={() =>
          first &&
          setGeometry(first.id, { position: first.position ?? { x: 0, y: 0 } })
        }
      >
        Clear size
      </button>
      <button type="button" onClick={() => first && minimize(first.id)}>
        Minimize notes
      </button>
      <button type="button" onClick={() => first && restore(first.id)}>
        Restore notes
      </button>
      <button type="button" onClick={() => first && toggleMaximize(first.id)}>
        Toggle maximize
      </button>
      <button
        type="button"
        onClick={() =>
          first && setGeometry(first.id, { position: { x: 300, y: 200 } })
        }
      >
        Move notes
      </button>
      <div data-testid="surface">
        {windows.map((entry) => (
          <Window key={entry.id} windowId={entry.id} />
        ))}
      </div>
    </>
  );
}

// The surface gets its size before the window opens, so the window's first
// layout clamps against it.
export function renderDesktop(options: WindowCreateOptions = {}): {
  view: RenderResult;
  windowRoot: HTMLElement;
} {
  const view = render(
    <WindowStateProvider>
      <DesktopHarness options={options} />
      <GeometryProbe />
    </WindowStateProvider>,
  );
  stubLayout(view.getByTestId("surface"), {
    clientHeight: 600,
    clientWidth: 800,
  });
  fireEvent.click(view.getByRole("button", { name: "Open notes" }));
  const windowRoot = view.container.querySelector<HTMLDivElement>(".window");
  if (!windowRoot) throw new Error("window not rendered");
  return { view, windowRoot };
}

export function committedGeometry(view: RenderResult): {
  position?: { x: number; y: number };
  size?: { height: number; width: number };
} {
  return JSON.parse(
    view.getByRole("status", { name: "committed geometry" }).textContent ??
      "{}",
  );
}
