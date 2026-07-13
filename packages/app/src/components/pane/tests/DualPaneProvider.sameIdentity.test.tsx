import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  downloadPaneKeyPackageBackup,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  restorePaneKeyPackageBackup,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

const REALTIME_ORGANIZATION_NAME = "Realtime Organization";

function getPaneStatusValue(pane: HTMLElement, label: string): string {
  const rowHeader = within(pane).getByRole("rowheader", { name: label });
  const row = rowHeader.closest("tr");
  invariant(row, `Expected ${label} status row.`);
  const value = row.querySelector("td");
  invariant(value, `Expected ${label} status value.`);
  return value.textContent?.trim() ?? "";
}

async function createOrganization(pane: HTMLElement, name: string) {
  const organizationSelect = within(pane).getByRole("combobox", {
    name: "Organizations",
  });
  invariant(
    organizationSelect instanceof HTMLButtonElement,
    "Expected organization selector.",
  );
  await waitFor(() => {
    expect(organizationSelect.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(organizationSelect);
  });
  await interact(() => {
    fireEvent.click(
      within(pane).getByRole("button", { name: "New Organization" }),
    );
  });

  const dialog = await screen.findByRole("dialog", {
    name: "New Organization",
  });
  await interact(() => {
    fireEvent.change(within(dialog).getByLabelText("Organization name"), {
      target: { value: name },
    });
  });
  await interact(() => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  });
  await waitForCondition(
    () => screen.queryByRole("dialog", { name: "New Organization" }) === null,
    `Organization creation did not finish: ${dialog.textContent?.trim() ?? "unknown dialog state"}`,
    20_000,
  );
}

function ensureOrganizationOptionsOpen(pane: HTMLElement): boolean {
  const organizationSelect = within(pane).getByRole("combobox", {
    name: "Organizations",
  });
  if (organizationSelect.getAttribute("aria-expanded") === "true") {
    return true;
  }

  fireEvent.click(organizationSelect);
  return false;
}

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "an entitled organization profile name appears in another session without Refresh",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const primaryPane = getPaneRoot(view, "left");
    const secondaryPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(primaryPane, secondaryPane);
    const primaryUserId = getPaneUserId(primaryPane);
    expect(getPaneUserId(secondaryPane)).not.toBe(primaryUserId);

    const primarySession = getPaneStatusValue(primaryPane, "Session");
    const backupJson = await downloadPaneKeyPackageBackup(primaryPane);
    await restorePaneKeyPackageBackup(secondaryPane, backupJson);

    await waitForCondition(
      () => getPaneUserId(secondaryPane) === primaryUserId,
      "Secondary pane did not switch to the primary identity.",
      20_000,
    );
    await waitForCondition(
      () => {
        const secondarySession = getPaneStatusValue(secondaryPane, "Session");
        return (
          secondarySession !== "none" && secondarySession !== primarySession
        );
      },
      "Secondary pane did not establish a distinct session.",
      20_000,
    );
    await waitForCondition(
      () => getPaneStatusValue(secondaryPane, "Web Socket") === "connected",
      "Secondary pane websocket did not reconnect after identity restore.",
      20_000,
    );

    await openOrgManager(primaryPane);
    await openOrgManager(secondaryPane);

    let secondaryOrganizationCountBefore = 0;
    let secondaryUntitledCountBefore = 0;
    await waitForCondition(
      () => {
        if (!ensureOrganizationOptionsOpen(secondaryPane)) {
          return false;
        }
        secondaryOrganizationCountBefore =
          within(secondaryPane).queryAllByRole("option").length;
        secondaryUntitledCountBefore = within(secondaryPane).queryAllByRole(
          "option",
          { name: "Untitled organization" },
        ).length;
        return secondaryOrganizationCountBefore > 0;
      },
      "Secondary session did not load its initial organizations.",
      20_000,
    );
    await interact(() => {
      fireEvent.click(
        within(secondaryPane).getByRole("combobox", {
          name: "Organizations",
        }),
      );
    });

    await createOrganization(primaryPane, REALTIME_ORGANIZATION_NAME);

    await waitForCondition(
      () =>
        within(primaryPane)
          .getByRole("combobox", { name: "Organizations" })
          .textContent?.includes(REALTIME_ORGANIZATION_NAME) === true,
      "New organization did not become active in the primary session.",
      20_000,
    );

    // Additional organizations begin local-only, so their encrypted profile
    // name must remain device-local. Option growth proves the new root was
    // discovered, while the exact name must still be unavailable remotely.
    await waitForCondition(
      () => {
        if (!ensureOrganizationOptionsOpen(secondaryPane)) {
          return false;
        }
        const options = within(secondaryPane).queryAllByRole("option");
        return options.length > secondaryOrganizationCountBefore;
      },
      "Secondary session did not discover the new organization in realtime.",
      20_000,
    );
    expect(
      within(secondaryPane).queryByRole("option", {
        name: REALTIME_ORGANIZATION_NAME,
      }),
      "A local-only organization must not upload its seeded encrypted name.",
    ).toBeNull();
    expect(
      within(secondaryPane).getAllByRole("option", {
        name: "Untitled organization",
      }).length,
    ).toBeGreaterThan(secondaryUntitledCountBefore);
    const newRemoteOrganizationOption = within(secondaryPane)
      .getAllByRole("option", { name: "Untitled organization" })
      .at(-1);
    invariant(
      newRemoteOrganizationOption,
      "Expected the newly discovered organization option.",
    );
    await interact(() => {
      fireEvent.click(newRemoteOrganizationOption);
    });

    // The organization profile intentionally remains local-only until the
    // trial starts, but Trash is part of the server-side provisioning
    // transaction. A recovered session can therefore read its initialized
    // metadata immediately even though ordinary writes are still disabled.
    await openExplorer(secondaryPane);
    await waitForCondition(
      () => getExplorerSidebarItemsByName(secondaryPane, "Trash").length > 0,
      "Secondary session did not materialize provisioned Trash metadata.",
      20_000,
    );

    await interact(() => {
      fireEvent.click(
        within(primaryPane).getByRole("button", { name: "Billing" }),
      );
    });
    const startTrialButton = await within(primaryPane).findByRole("button", {
      name: "Start free trial",
    });
    invariant(
      startTrialButton instanceof HTMLButtonElement,
      "Expected Start free trial button.",
    );
    await waitFor(() => {
      expect(startTrialButton.disabled).toBe(false);
    });
    await interact(() => {
      fireEvent.click(startTrialButton);
    });
    await waitForCondition(
      () => within(primaryPane).queryByText("Free trial") !== null,
      "Primary organization did not enter the free trial.",
      20_000,
    );

    // Trial entitlement activates sync, which uploads the already-seeded
    // profile document. The secondary's open Org Manager must consume the
    // realtime hint and replace the placeholder without Refresh or reopening.
    await waitForCondition(
      () => {
        if (!ensureOrganizationOptionsOpen(secondaryPane)) {
          return false;
        }
        return (
          within(secondaryPane).queryByRole("option", {
            name: REALTIME_ORGANIZATION_NAME,
          }) !== null
        );
      },
      "Secondary session did not materialize the entitled organization profile name.",
      20_000,
    );
    expect(
      within(secondaryPane).queryAllByRole("option", {
        name: "Untitled organization",
      }),
    ).toHaveLength(secondaryUntitledCountBefore);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
