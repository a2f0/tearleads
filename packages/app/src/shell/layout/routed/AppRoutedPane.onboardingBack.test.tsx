import { afterEach, expect, test } from "bun:test";
import { fireEvent, within } from "@testing-library/react";
import invariant from "invariant";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/paneTestUtils";
import {
  forceTabletRoutedTier,
  renderRoutedPane,
} from "../../../../test/helpers/routedPaneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "the routed app bar Back leaves the restore form for the identity choice",
  async () => {
    const restoreMatchMedia = forceTabletRoutedTier();
    let view: ReturnType<typeof renderRoutedPane> | undefined;
    try {
      view = renderRoutedPane(
        createTestHostConfig({
          autoProvisionIdentity: true,
          promptAccountName: true,
        }),
      );
      const routed = view;
      const [restore] = await routed.findAllByRole(
        "button",
        { name: "Restore identity" },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
      invariant(restore, "Expected the first-launch identity choice");
      fireEvent.click(restore);
      await routed.findByRole("textbox", { name: "Recovery passphrase" });

      // The form is not a route, so there is no browser history to pop: the
      // app bar's Back must step the onboarding back instead.
      const appBar = routed.container.querySelector<HTMLElement>(
        ".routed-pane-appbar",
      );
      invariant(appBar, "Expected the routed app bar");
      fireEvent.click(within(appBar).getByRole("button", { name: "Back" }));

      await routed.findAllByRole("button", { name: "Restore identity" });
      expect(
        routed.queryByRole("textbox", { name: "Recovery passphrase" }),
      ).toBeNull();
    } finally {
      view?.unmount();
      restoreMatchMedia();
    }
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);
