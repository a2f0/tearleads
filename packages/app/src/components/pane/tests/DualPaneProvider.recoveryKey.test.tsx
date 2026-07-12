import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  getPaneRoot,
  getPaneUserId,
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
import {
  requestPath,
  summarizeProxiedApiRequests,
} from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

async function expectAppRuntimeSettled() {
  let settled = false;
  await act(async () => {
    settled = await waitForAppTestRuntimeToSettle({ timeoutMs: 6_000 });
  });
  expect(settled).toBe(true);
}

test(
  "a fresh pane rematerializes the built-in self contact from a recovery key",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane({ autoProvisionRight: false });
    const primaryPane = getPaneRoot(view, "left");
    const secondaryPane = getPaneRoot(view, "right");

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
      20_000,
    );
    await expectAppRuntimeSettled();
    const primarySelfIdentity = await readPaneExplorerDocumentIdentity(
      primaryPane,
      "You",
    );
    expect(primarySelfIdentity.documentId).not.toBeNull();
    const primarySelfDocumentId = primarySelfIdentity.documentId;
    if (primarySelfDocumentId === null) {
      throw new Error(
        "Primary self contact did not acquire a remote identity.",
      );
    }

    const recoveryKey = await downloadPaneRecoveryKey(primaryPane);

    // A pristine pane must initialize its local keychain before Identity Manager
    // becomes available. Do not register that disposable local identity.
    await generatePaneKeyPairFromMenu(secondaryPane);
    const restoreRequestStartIndex = listProxiedApiRequests().length;
    await restorePaneRecoveryKey(secondaryPane, recoveryKey);
    await waitForCondition(
      () => getPaneUserId(secondaryPane) === primaryUserId,
      "Secondary pane did not restore the primary identity.",
      20_000,
    );

    await openExplorer(secondaryPane);
    await waitForCondition(
      () =>
        Array.from(
          secondaryPane.querySelectorAll<HTMLButtonElement>(
            "button.explorer-sidebar-item",
          ),
        ).some((button) => button.textContent?.trim() === "Contacts"),
      "Recovered Contacts container did not appear in Explorer.",
      20_000,
    );
    await selectContainerAndWaitForItemTable(secondaryPane, "Contacts");
    await waitForCondition(
      () => {
        const contactsItemsTable = within(secondaryPane).queryByRole("table", {
          name: "Items in Contacts",
        });
        return (
          contactsItemsTable !== null &&
          within(contactsItemsTable).queryAllByRole("button", { name: "You" })
            .length === 1
        );
      },
      "Recovered self contact did not appear exactly once with the You label.",
      20_000,
    );

    await expectAppRuntimeSettled();

    const postRestoreRequests = listProxiedApiRequests().slice(
      restoreRequestStartIndex,
    );
    const missingContainerDocumentLists = postRestoreRequests.filter(
      (request) =>
        request.method === "GET" &&
        request.status === 404 &&
        /^\/containers\/[^/]+\/documents$/u.test(requestPath(request.url)),
    );
    expect(
      missingContainerDocumentLists,
      `Recovery rematerialization requested a missing container.\nrequests=\n${summarizeProxiedApiRequests(postRestoreRequests)}`,
    ).toEqual([]);
    const contactsButtons = Array.from(
      secondaryPane.querySelectorAll<HTMLButtonElement>(
        "button.explorer-sidebar-item",
      ),
    ).filter((button) => button.textContent?.trim() === "Contacts");
    expect(
      contactsButtons,
      "Recovery should converge the pre-auth and rematerialized Contacts containers.",
    ).toHaveLength(1);
    const recoveredContactsButton = contactsButtons[0];
    expect(recoveredContactsButton).toBeTruthy();
    await act(async () => {
      if (recoveredContactsButton) {
        fireEvent.click(recoveredContactsButton);
      }
    });
    await waitForCondition(
      () => {
        const currentItemsTable = within(secondaryPane).queryByRole("table", {
          name: "Items in Contacts",
        });
        if (!currentItemsTable) {
          return false;
        }
        const selfButtons = within(currentItemsTable).queryAllByRole("button", {
          name: "You",
        });
        return (
          selfButtons.length === 1 &&
          selfButtons[0]?.getAttribute("data-document-local-id") ===
            primarySelfDocumentId
        );
      },
      "Recovered self contact did not converge on the primary document identity.",
      20_000,
    );
    const contactsItemsTable = within(secondaryPane).getByRole("table", {
      name: "Items in Contacts",
    });
    expect(
      within(contactsItemsTable).getAllByRole("button", { name: "You" }),
    ).toHaveLength(1);
    expect(
      contactsItemsTable.querySelectorAll("tr.explorer-item-table-row"),
    ).toHaveLength(1);
    expect(
      within(contactsItemsTable).queryByRole("button", {
        name: primaryUserId,
      }),
    ).toBeNull();

    const secondarySelfIdentity = await readPaneExplorerDocumentIdentity(
      secondaryPane,
      "You",
    );
    expect(
      secondarySelfIdentity.documentId,
      `Recovered self contact remained local-only (${secondarySelfIdentity.localId}).\nrequests=\n${summarizeProxiedApiRequests(postRestoreRequests)}`,
    ).toBe(primarySelfDocumentId);
    expect(secondarySelfIdentity.containerId).toBe(
      primarySelfIdentity.containerId,
    );
    expect(secondarySelfIdentity.localId).toBe(primarySelfDocumentId);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
