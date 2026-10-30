import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { AppTestRuntimeScopeProbe } from "../../../../test/helpers/appRuntimeIdle";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createTestHostConfig,
  PANE_ASYNC_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/paneTestUtils";
import { renderEmptyDesktop } from "../../../../test/helpers/renderEmptyDesktop";
import { SystemMonitorDeveloperModeProvider } from "../../../mini-apps/system-monitor/systemMonitorDeveloperMode";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { APP_THEMES } from "../../../theme/themes";
import { WallpaperProvider } from "../../../theme/WallpaperProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

afterEach(cleanupPaneTestEnvironment);

// The pane as Layout mounts it: below the app-wide theme and wallpaper.
function renderThemedPane() {
  return renderEmptyDesktop(
    <ThemeProvider themes={APP_THEMES}>
      <WallpaperProvider>
        <SystemMonitorDeveloperModeProvider>
          <DualPaneProvider>
            <PaneSideProvider side="left">
              <PaneProvider hostConfig={createTestHostConfig()}>
                <AppTestRuntimeScopeProbe />
                <Pane className="pane" />
              </PaneProvider>
            </PaneSideProvider>
          </DualPaneProvider>
        </SystemMonitorDeveloperModeProvider>
      </WallpaperProvider>
    </ThemeProvider>,
  );
}

test(
  "the desktop menu opens Display Properties, which repaints the wallpaper",
  async () => {
    const view = renderThemedPane();
    const wallpaper = () =>
      view.container
        .querySelector(".pane-main > .desktop-wallpaper")
        ?.getAttribute("data-wallpaper");
    expect(wallpaper()).toBe("blocks");

    // No identity is needed: the settings are app-wide display preferences.
    await act(async () => {
      fireEvent.contextMenu(view.getByRole("application"), {
        clientX: 160,
        clientY: 160,
      });
    });
    await act(async () => {
      clickPaneAppMenuItem(view, "Display Properties");
    });

    const background = await view.findByRole("group", { name: "Background" });
    const dialog = background.closest<HTMLElement>(".window");
    expect(dialog?.querySelector(".window-titlebar-title")?.textContent).toBe(
      "Display Properties",
    );
    expect(
      within(background)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["blocks", "honeycomb", "triangles", "plain"]);

    await act(async () => {
      fireEvent.click(
        within(background).getByRole("radio", { name: "Honeycomb" }),
      );
    });
    await waitFor(() => expect(wallpaper()).toBe("honeycomb"));
    expect(localStorage.getItem("tearleads.wallpaper.choice")).toBe(
      "honeycomb",
    );

    const theme = view.getByRole("group", { name: "Theme" });
    await act(async () => {
      fireEvent.click(within(theme).getByRole("radio", { name: "Dusk" }));
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dusk");
    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
