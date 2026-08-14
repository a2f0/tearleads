import { afterEach, expect, test } from "bun:test";
import { DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  downloadPaneRecoveryKey,
  readPaneExplorerDocumentIdentity,
  restorePaneRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

const REALTIME_ORGANIZATION_NAME = "Realtime Organization";
const SAME_IDENTITY_SETTLE_TIMEOUT_MS = 15_000;
const SELF_CONTACT_TIMEOUT_MS = 30_000;

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

async function expectAppRuntimeSettled() {
  let settled = false;
  await act(async () => {
    settled = await waitForAppTestRuntimeToSettle({
      timeoutMs: SAME_IDENTITY_SETTLE_TIMEOUT_MS,
    });
  });
  expect(settled).toBe(true);
}

async function expectSingleYouContact(input: {
  expectedLocalId?: string | undefined;
  pane: HTMLElement;
  userId: string;
}) {
  // Re-focus Explorer even when a prior window remains mounted. The active
  // mini-app can change while the organization workflow runs, and a mounted
  // sidebar is not evidence that its item table is currently available.
  await openExplorer(input.pane);
  await waitForCondition(
    () => getExplorerSidebarItemsByName(input.pane, "Contacts").length > 0,
    "Explorer did not materialize the personal Contacts container.",
    SELF_CONTACT_TIMEOUT_MS,
  );
  await selectContainerAndWaitForItemTable(input.pane, "Contacts");
  await waitForCondition(
    () => {
      const table = within(input.pane).queryByRole("table", {
        name: "Items in Contacts",
      });
      if (!table) {
        return false;
      }
      const selfButtons = within(table).queryAllByRole("button", {
        name: "You",
      });
      return (
        selfButtons.length === 1 &&
        (input.expectedLocalId === undefined ||
          selfButtons[0]?.getAttribute("data-document-local-id") ===
            input.expectedLocalId)
      );
    },
    "Explorer did not preserve the current identity's You contact.",
    SELF_CONTACT_TIMEOUT_MS,
  );

  const table = within(input.pane).getByRole("table", {
    name: "Items in Contacts",
  });
  expect(
    within(table).queryByRole("button", { name: input.userId }),
  ).toBeNull();
}

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "a recovered peer shares a newly created local organization name and preserves the You label",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane({ autoProvisionRight: false });
    const primaryPane = getPaneRoot(view, "left");
    const secondaryPane = getPaneRoot(view, "right");

    await waitForSinglePaneProvisioning(primaryPane);
    const primaryUserId = getPaneUserId(primaryPane);
    await expectAppRuntimeSettled();
    await expectSingleYouContact({ pane: primaryPane, userId: primaryUserId });
    const primarySelfIdentity = await readPaneExplorerDocumentIdentity(
      primaryPane,
      "You",
    );
    const primarySelfDocumentId = primarySelfIdentity.documentId;
    invariant(
      primarySelfDocumentId,
      "Primary self contact did not acquire a remote identity.",
    );

    const recoveryKey = await downloadPaneRecoveryKey(primaryPane);
    await generatePaneKeyPairFromMenu(secondaryPane);
    await restorePaneRecoveryKey(secondaryPane, recoveryKey);
    await waitForCondition(
      () => getPaneUserId(secondaryPane) === primaryUserId,
      "Secondary pane did not restore the primary identity.",
      20_000,
    );
    await waitForCondition(
      () => getPaneStatusValue(secondaryPane, "Web Socket") === "connected",
      "Secondary pane websocket did not reconnect after identity recovery.",
      20_000,
    );
    await expectAppRuntimeSettled();
    // Both panes derive the same deterministic self-contact local id from the
    // shared signing fingerprint; the recovered pane adopts the primary's
    // remote self-contact document onto that row instead of materializing a
    // second row under the remote document id.
    await expectSingleYouContact({
      expectedLocalId: primarySelfIdentity.localId,
      pane: secondaryPane,
      userId: primaryUserId,
    });
    const secondarySelfIdentity = await readPaneExplorerDocumentIdentity(
      secondaryPane,
      "You",
      { containerName: "Contacts", expectedDocumentId: primarySelfDocumentId },
    );
    expect(secondarySelfIdentity.documentId).toBe(primarySelfDocumentId);

    await openOrgManager(primaryPane);
    await openOrgManager(secondaryPane);
    await waitForCondition(
      () =>
        [primaryPane, secondaryPane].every(
          (pane) =>
            within(pane)
              .queryByRole("combobox", { name: "Organizations" })
              ?.textContent?.includes(
                DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
              ) === true,
        ),
      "Both sessions did not resolve the personal organization name.",
      20_000,
    );

    let primaryOrganizationCountBefore = 0;
    let primaryUntitledCountBefore = 0;
    await waitForCondition(
      () => {
        if (!ensureOrganizationOptionsOpen(primaryPane)) {
          return false;
        }
        primaryOrganizationCountBefore =
          within(primaryPane).queryAllByRole("option").length;
        primaryUntitledCountBefore = within(primaryPane).queryAllByRole(
          "option",
          { name: "Untitled organization" },
        ).length;
        return primaryOrganizationCountBefore > 0;
      },
      "Primary session did not load its initial organizations.",
      20_000,
    );
    await interact(() => {
      fireEvent.click(
        within(primaryPane).getByRole("combobox", {
          name: "Organizations",
        }),
      );
    });

    await createOrganization(secondaryPane, REALTIME_ORGANIZATION_NAME);
    await waitForCondition(
      () =>
        within(secondaryPane)
          .queryByRole("combobox", { name: "Organizations" })
          ?.textContent?.includes(REALTIME_ORGANIZATION_NAME) === true,
      "New organization did not become active in the recovered session.",
      20_000,
    );

    let primaryOrganizationCountAfter = 0;
    let primaryUntitledCountAfter = 0;
    await waitForCondition(
      () => {
        if (!ensureOrganizationOptionsOpen(primaryPane)) {
          return false;
        }
        const options = within(primaryPane).queryAllByRole("option");
        primaryOrganizationCountAfter = options.length;
        primaryUntitledCountAfter = within(primaryPane).queryAllByRole(
          "option",
          { name: "Untitled organization" },
        ).length;
        return (
          options.length > primaryOrganizationCountBefore &&
          within(primaryPane).queryByRole("option", {
            name: REALTIME_ORGANIZATION_NAME,
          }) !== null
        );
      },
      "Primary session did not materialize the new organization profile name.",
      20_000,
    );
    expect(primaryOrganizationCountAfter).toBeGreaterThan(
      primaryOrganizationCountBefore,
    );
    expect(primaryUntitledCountAfter).toBe(primaryUntitledCountBefore);
    await interact(() => {
      fireEvent.click(
        within(primaryPane).getByRole("combobox", {
          name: "Organizations",
        }),
      );
    });

    await expectAppRuntimeSettled();
    await expectSingleYouContact({ pane: primaryPane, userId: primaryUserId });
    await expectSingleYouContact({
      expectedLocalId: primarySelfIdentity.localId,
      pane: secondaryPane,
      userId: primaryUserId,
    });
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
