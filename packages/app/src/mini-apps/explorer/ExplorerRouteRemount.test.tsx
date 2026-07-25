import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createTestHostConfig,
  flattenPaneStatusText,
} from "../../../test/helpers/paneTestUtils";
import { App } from "../../App";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../system-monitor/systemMonitorMode";

afterEach(async () => {
  cleanup();
  await cleanupPaneTestEnvironment();
});

const SELECTED_NOTE_TITLE = "remount route note";
const TEST_TIMEOUT_MS = 60_000;

function pinSystemMonitors() {
  for (const side of ["left", "right"] as const) {
    saveSystemMonitorMode(systemMonitorModeStorageKey(side), "pinned");
  }
}

function visiblePane(view: ReturnType<typeof render>): HTMLElement {
  const pane = view.container.querySelector<HTMLElement>(
    ".pane:not(.pane-hidden)",
  );
  invariant(pane, "Expected a visible (active) pane.");
  return pane;
}

function navModeButton(view: ReturnType<typeof render>): HTMLButtonElement {
  const button = view.queryByRole("button", {
    name: /Switch to (?:iPad \/ mobile|windowed) layout/,
  });
  invariant(button, "Expected the navigation-mode toggle.");
  invariant(button instanceof HTMLButtonElement, "Expected a button.");
  return button;
}

async function openExplorerInPane(
  view: ReturnType<typeof render>,
  pane: HTMLElement,
): Promise<HTMLDivElement> {
  fireEvent.contextMenu(pane, { clientX: 120, clientY: 120 });
  clickPaneAppMenuItem(view, "Explorer");

  let explorerWindow: HTMLDivElement | null = null;
  await waitFor(() => {
    const windows = pane.querySelectorAll<HTMLDivElement>("div.window");
    explorerWindow = windows[windows.length - 1] ?? null;
    expect(explorerWindow).toBeTruthy();
    expect(
      within(explorerWindow as HTMLDivElement).getByRole("table", {
        name: "Items in /",
      }),
    ).toBeTruthy();
  });
  invariant(explorerWindow, "explorer window not found");
  return explorerWindow;
}

// Remounting Explorer while its window route still points at a selected document
// (e.g. crossing the windowed/routed breakpoint, or a workspace round trip) used
// to strand the detail pane on "Select a container.": the route was restored but
// the document's summary was never reloaded into the freshly mounted view.
test(
  "explorer keeps the selected document across a layout remount",
  async () => {
    pinSystemMonitors();
    const view = render(
      <App
        hostConfig={createTestHostConfig({ autoProvisionIdentity: true })}
      />,
    );

    await waitFor(
      () => {
        expect(flattenPaneStatusText(visiblePane(view))).toMatch(
          /userId:\s*[0-9a-f]{8}-/u,
        );
      },
      { timeout: TEST_TIMEOUT_MS },
    );

    const explorer = await openExplorerInPane(view, visiblePane(view));

    // Create a note, then select it from the sidebar so Explorer is on the
    // document-selection route.
    fireEvent.click(within(explorer).getByText("File"));
    fireEvent.click(
      await within(explorer).findByRole("menuitem", { name: "New Document" }),
    );
    fireEvent.click(within(explorer).getByRole("button", { name: "Note" }));
    const editor = await within(explorer).findByRole("textbox", {
      name: /Notes editor/,
    });
    invariant(editor instanceof HTMLTextAreaElement, "note editor not found");
    fireEvent.change(editor, { target: { value: SELECTED_NOTE_TITLE } });

    const noteSelector = "button.explorer-sidebar-item--note";
    await waitFor(() => {
      expect(
        Array.from(
          explorer.querySelectorAll<HTMLButtonElement>(noteSelector),
        ).some((button) => button.textContent?.trim() === SELECTED_NOTE_TITLE),
      ).toBe(true);
    });
    const noteItem = Array.from(
      explorer.querySelectorAll<HTMLButtonElement>(noteSelector),
    ).find((button) => button.textContent?.trim() === SELECTED_NOTE_TITLE);
    invariant(noteItem, "note sidebar item not found");
    fireEvent.click(noteItem);

    await waitFor(() => {
      const selected = within(explorer).getByRole("textbox", {
        name: /Notes editor/,
      });
      invariant(
        selected instanceof HTMLTextAreaElement,
        "selected note editor not found",
      );
      expect(selected.value).toBe(SELECTED_NOTE_TITLE);
    });

    // Cross into routed layout (unmounts the windowed pane surface), then back
    // into windowed layout (remounts it) through the lower-right switches.
    fireEvent.click(navModeButton(view));
    await waitFor(() => {
      expect(view.container.querySelector("div.window")).toBeNull();
    });
    fireEvent.click(navModeButton(view));

    // Back in windowed layout the Explorer window remounts; the selected
    // document must be restored, not "Select a container."
    let restoredExplorer: HTMLDivElement | null = null;
    await waitFor(
      () => {
        const pane = visiblePane(view);
        const windows = pane.querySelectorAll<HTMLDivElement>("div.window");
        restoredExplorer = windows[windows.length - 1] ?? null;
        expect(restoredExplorer).toBeTruthy();
      },
      { timeout: TEST_TIMEOUT_MS },
    );
    invariant(restoredExplorer, "explorer window did not remount");

    await waitFor(
      () => {
        expect(
          within(restoredExplorer as HTMLDivElement).queryByText(
            "Select a container.",
          ),
        ).toBeNull();
        const restored = within(restoredExplorer as HTMLDivElement).getByRole(
          "textbox",
          { name: /Notes editor/ },
        );
        invariant(
          restored instanceof HTMLTextAreaElement,
          "note editor missing after layout remount",
        );
        expect(restored.value).toBe(SELECTED_NOTE_TITLE);
      },
      { timeout: TEST_TIMEOUT_MS },
    );

    view.unmount();
  },
  TEST_TIMEOUT_MS * 2,
);
