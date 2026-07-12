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
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  restorePaneKeyPackageBackup,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
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
  "a new organization appears in another session for the same identity",
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
    await waitForCondition(
      () => {
        if (!ensureOrganizationOptionsOpen(secondaryPane)) {
          return false;
        }
        secondaryOrganizationCountBefore =
          within(secondaryPane).queryAllByRole("option").length;
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

    // Additional organizations begin local-only, so their encrypted profile
    // name is not remotely available yet. Option growth specifically proves the
    // new root was discovered; the menu footer is not an `option`.
    await waitForCondition(
      () => {
        if (!ensureOrganizationOptionsOpen(secondaryPane)) {
          return false;
        }
        return (
          within(secondaryPane).queryAllByRole("option").length >
          secondaryOrganizationCountBefore
        );
      },
      "Secondary session did not discover the new organization in realtime.",
      20_000,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
