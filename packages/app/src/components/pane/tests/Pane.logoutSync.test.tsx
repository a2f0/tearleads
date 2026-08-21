import { afterEach, expect, test } from "bun:test";
import { DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME } from "@symcrypt/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  DUAL_PANE_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  getPaneRoot,
  getPaneUserId,
  openIdentityManagerForPane,
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
import { flattenPaneStatusText } from "../../../../test/helpers/paneTestUtils";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

async function expectAppRuntimeSettled(): Promise<void> {
  let settled = false;
  await act(async () => {
    settled = await waitForAppTestRuntimeToSettle({ timeoutMs: 6_000 });
  });
  expect(settled).toBe(true);
}

async function logoutFromIdentityManager(pane: HTMLElement): Promise<void> {
  const identityManagerWindow = await openIdentityManagerForPane(pane);
  fireEvent.click(
    within(identityManagerWindow).getByRole("button", { name: "General" }),
  );
  const identityHeading = await within(identityManagerWindow).findByRole(
    "heading",
    { name: "Identity" },
  );
  const identitySection = identityHeading.closest("section");
  if (!identitySection) {
    throw new Error("Expected Identity Manager identity section.");
  }

  fireEvent.click(
    within(identitySection).getByRole("button", {
      name: "Identity actions",
    }),
  );
  const actionsMenu = document.body.querySelector<HTMLElement>(".menu");
  if (!actionsMenu) {
    throw new Error("Expected the identity actions menu to open.");
  }
  fireEvent.click(within(actionsMenu).getByRole("button", { name: "Log Out" }));

  const dialog = await within(pane).findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Log Out" }));
  await waitFor(() => {
    expect(flattenPaneStatusText(pane)).toMatch(/session:\s*none/iu);
  });
}

test(
  "logging out leaves a recovered, fully synced personal contact unchanged",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane({ autoProvisionRight: false });
    const primaryPane = getPaneRoot(view, "left");
    const recoveredPane = getPaneRoot(view, "right");

    await waitForSinglePaneProvisioning(primaryPane);
    const primaryUserId = getPaneUserId(primaryPane);
    await openExplorer(primaryPane);
    const primaryContactsItemsTable = await selectContainerAndWaitForItemTable(
      primaryPane,
      "Contacts",
    );
    await waitForCondition(
      () =>
        within(primaryContactsItemsTable).queryAllByRole("button", {
          name: "You",
        }).length === 1,
      "Primary bootstrap did not provision exactly one self contact.",
      DUAL_PANE_TEST_TIMEOUT_MS,
    );
    await expectAppRuntimeSettled();
    expect(
      (await readPaneExplorerDocumentIdentity(primaryPane, "You")).documentId,
    ).not.toBeNull();

    const recoveryKey = await downloadPaneRecoveryKey(primaryPane);
    await generatePaneKeyPairFromMenu(recoveredPane);
    await restorePaneRecoveryKey(recoveredPane, recoveryKey);
    await waitForCondition(
      () => getPaneUserId(recoveredPane) === primaryUserId,
      "Recovered pane did not restore the primary identity.",
      DUAL_PANE_TEST_TIMEOUT_MS,
    );

    await openOrgManager(recoveredPane);
    await waitForCondition(
      () =>
        within(recoveredPane)
          .queryByRole("combobox", { name: "Organizations" })
          ?.textContent?.includes(
            DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
          ) === true,
      "Recovered Org Manager did not resolve the personal organization.",
      DUAL_PANE_TEST_TIMEOUT_MS,
    );
    await openExplorer(recoveredPane);
    await waitForCondition(
      () =>
        within(recoveredPane).queryAllByRole("button", { name: "Contacts" })
          .length > 0,
      "Recovered bootstrap did not rematerialize Contacts.",
      DUAL_PANE_TEST_TIMEOUT_MS,
    );
    const recoveredContactsItemsTable =
      await selectContainerAndWaitForItemTable(recoveredPane, "Contacts");
    await waitForCondition(
      () =>
        within(recoveredContactsItemsTable).queryAllByRole("button", {
          name: "You",
        }).length === 1,
      "Recovered bootstrap did not rematerialize exactly one self contact.",
      DUAL_PANE_TEST_TIMEOUT_MS,
    );
    await expectAppRuntimeSettled();
    expect(
      (await readPaneExplorerDocumentIdentity(recoveredPane, "You")).documentId,
    ).not.toBeNull();
    await waitFor(() => {
      expect(
        within(recoveredPane).getByRole("button", {
          name: "All changes synced",
        }),
      ).toBeTruthy();
    });

    await logoutFromIdentityManager(recoveredPane);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_000)));

    await waitFor(() => {
      expect(
        within(recoveredPane).getByRole("button", {
          name: "All changes synced",
        }),
      ).toBeTruthy();
    });
    view.unmount();
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
