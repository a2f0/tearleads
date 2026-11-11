import { afterEach, expect, test } from "bun:test";
import {
  LauncherNavigationProvider,
  MiniAppWindow,
  useWindowStateData,
  WindowStateProvider,
} from "@tearleads/windowing";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { PaneFooter } from "../footer/PaneFooter";

const EmptyApp = () => null;

function OpenWindows() {
  const { windows } = useWindowStateData();
  return windows.map((entry) => (
    <MiniAppWindow key={entry.id} windowId={entry.id} />
  ));
}

function LabeledLauncher() {
  const { signingKeyPair } = useIdentity();
  if (!signingKeyPair) return null;
  return (
    <WindowStateProvider>
      <LauncherNavigationProvider
        definition={{
          apps: {
            contacts: { createComponent: () => EmptyApp, title: "Contacts" },
            notes: {
              createComponent: () => EmptyApp,
              iconLabel: "Quick notes",
              title: "Notes",
            },
            "display-properties": {
              createComponent: () => EmptyApp,
              iconLabel: "Appearance",
              title: "Display Properties",
            },
          },
        }}
        defaultWindowEnabled={false}
        mode="windowed"
      >
        <section aria-label="Labeled launcher">
          <PaneFooter />
          <OpenWindows />
        </section>
      </LauncherNavigationProvider>
    </WindowStateProvider>
  );
}

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "start menu labels use the launcher definition without renaming windows",
  async () => {
    const view = renderPane({ children: <LabeledLauncher /> });
    await generateIdentityAndWaitForDb(view);
    const launcher = within(
      view.getByRole("region", { name: "Labeled launcher" }),
    );
    fireEvent.click(launcher.getByRole("button", { name: "Menu" }));
    expect(view.getByRole("button", { name: "Contacts" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Appearance" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Quick notes" }));
    await waitFor(() => {
      expect(view.getByRole("region", { name: "Notes" })).toBeTruthy();
    });
    expect(
      launcher.getByRole("button", { name: "Activate Notes window" }),
    ).toBeTruthy();
    fireEvent.click(launcher.getByRole("button", { name: "Menu" }));
    fireEvent.click(view.getByRole("button", { name: "Appearance" }));
    expect(
      view.getByRole("region", { name: "Display Properties" }),
    ).toBeTruthy();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
