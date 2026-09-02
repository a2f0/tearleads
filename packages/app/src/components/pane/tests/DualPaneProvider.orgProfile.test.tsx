import { afterEach, expect, test } from "bun:test";
import { DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME } from "@tearleads/client-sdk";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  downloadPaneRecoveryKey,
  restorePaneRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

const RENAMED_ORGANIZATION_NAME = "Renamed Organization";

async function openOrganizationSection(pane: HTMLElement) {
  await interact(() => {
    const section = within(pane).getAllByRole("button", {
      name: "Organization",
    })[0];
    if (!section) {
      throw new Error("Expected the org-manager Organization section.");
    }
    fireEvent.click(section);
  });
  await waitForCondition(
    () => {
      const input = within(pane).queryByLabelText("Organization name");
      return input instanceof HTMLInputElement && !input.disabled;
    },
    "Organization section did not load the organization profile editor.",
    20_000,
  );
}

async function renameOrganization(pane: HTMLElement, name: string) {
  const input = within(pane).getByLabelText("Organization name");
  await interact(() => {
    fireEvent.change(input, { target: { value: name } });
    fireEvent.blur(input);
  });
  await waitForCondition(
    () =>
      within(pane)
        .queryByRole("combobox", { name: "Organizations" })
        ?.textContent?.includes(name) === true,
    "Renamed organization did not surface in the original session's switcher.",
    20_000,
  );
}

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "a recovered session resolves the organization name after the profile was opened on the original device",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane({ autoProvisionRight: false });
    const primaryPane = getPaneRoot(view, "left");
    const secondaryPane = getPaneRoot(view, "right");

    await waitForSinglePaneProvisioning(primaryPane);
    const primaryUserId = getPaneUserId(primaryPane);

    // The original device visits the organization profile editor before the
    // recovery, which is what a user who has ever looked at (or renamed) their
    // organization has already done.
    await openOrgManager(primaryPane);
    await openOrganizationSection(primaryPane);
    await waitFor(() => {
      expect(
        within(primaryPane)
          .getByRole("combobox", { name: "Organizations" })
          .textContent?.includes(DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME),
      ).toBe(true);
    });
    await renameOrganization(primaryPane, RENAMED_ORGANIZATION_NAME);

    const recoveryKey = await downloadPaneRecoveryKey(primaryPane);
    await generatePaneKeyPairFromMenu(secondaryPane);
    await restorePaneRecoveryKey(secondaryPane, recoveryKey);
    await waitForCondition(
      () => getPaneUserId(secondaryPane) === primaryUserId,
      "Secondary pane did not restore the primary identity.",
      20_000,
    );

    await openOrgManager(secondaryPane);
    await waitForCondition(
      () =>
        within(secondaryPane)
          .queryByRole("combobox", { name: "Organizations" })
          ?.textContent?.includes(RENAMED_ORGANIZATION_NAME) === true,
      "Recovered session did not resolve the organization name in the switcher.",
      20_000,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
