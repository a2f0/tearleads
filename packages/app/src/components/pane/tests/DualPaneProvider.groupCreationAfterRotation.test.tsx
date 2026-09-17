import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  getPaneRoot,
  getPaneUserId,
  interact,
  listExplorerContainerItems,
  openWindowMenuDialog,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  createNoteInContainer,
  openExplorer,
  refreshUntil,
  selectExplorerNoteByName,
  waitForExplorerNoteVisible,
  waitForSelectedNoteText,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  downloadPaneRecoveryKey,
  restorePaneRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";
import {
  createGroupAndAddPeer,
  openOrgManager,
  shareContainerWithGroup,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  capturePostShareSyncBaseline,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import {
  summarizeProxiedApiRequests,
  truncateText,
} from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

const GROUP_NAME = "Rotated recovery readers";
const NOTE_TEXT = "Historical group data survives current-head recovery";
const CURRENT_PRINCIPAL_RECOVERY_TIMEOUT_MS = 120_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

function hasGroupMember(pane: HTMLElement, userId: string): boolean {
  return Array.from(pane.querySelectorAll("strong")).some(
    (element) => element.getAttribute("title") === userId,
  );
}

async function selectGroup(pane: HTMLElement, groupName: string) {
  const groupsButton = within(pane).getAllByRole("button", {
    name: "Groups",
  })[0];
  invariant(groupsButton, "Expected the Org Manager Groups button.");
  await interact(() => {
    fireEvent.click(groupsButton);
  });
  const group = await within(pane).findByText(groupName);
  await interact(() => {
    fireEvent.click(group);
  });
  await within(pane).findByLabelText("User ID");
}

async function waitForPrincipalRematerialization() {
  let settled = false;
  await act(async () => {
    settled = await waitForAppTestRuntimeToSettle({
      apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
      timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    });
  });
  expect(settled).toBe(true);
}

async function removeGroupMember(
  pane: HTMLElement,
  groupName: string,
  userId: string,
) {
  await selectGroup(pane, groupName);
  const member = await waitFor(() => {
    const entry = Array.from(pane.querySelectorAll("strong")).find(
      (element) => element.getAttribute("title") === userId,
    );
    expect(entry).toBeTruthy();
    return entry;
  });
  invariant(member, "Expected the removable group member.");
  const row = member.closest<HTMLElement>(".org-manager-member-row");
  invariant(row, "Expected the group member row.");
  const removeButton = within(row).getByRole("button", { name: "Remove" });
  invariant(
    removeButton instanceof HTMLButtonElement,
    "Expected Remove button.",
  );
  await waitFor(() => {
    expect(removeButton.disabled).toBe(false);
  });
  const requestStart = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent.click(removeButton);
  });
  await waitForCondition(
    () => !hasGroupMember(pane, userId),
    `Peer was not removed from the custom group.\nrequests=\n${summarizeProxiedApiRequests(
      listProxiedApiRequests().slice(requestStart),
    )}\npane=${truncateText(pane.textContent ?? "")}`,
    90_000,
  );
  await waitForPrincipalRematerialization();
}

async function addGroupMember(
  pane: HTMLElement,
  groupName: string,
  userId: string,
) {
  await selectGroup(pane, groupName);
  const userIdInput = within(pane).getByLabelText("User ID");
  invariant(userIdInput instanceof HTMLInputElement, "Expected user ID input.");
  await interact(() => {
    fireEvent.change(userIdInput, { target: { value: userId } });
  });
  const addButton = within(pane).getByRole("button", { name: "Add" });
  invariant(addButton instanceof HTMLButtonElement, "Expected Add button.");
  await waitFor(() => {
    expect(addButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(addButton);
  });
  await waitForCondition(
    () => hasGroupMember(pane, userId),
    "Peer was not re-added to the custom group.",
    20_000,
  );
  await waitForPrincipalRematerialization();
}

test(
  "a fresh client creates a custom group after an unrelated root key rotation",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const ownerPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");
    await waitForDualPaneProvisioning(ownerPane, peerPane);
    const peerUserId = getPaneUserId(peerPane);
    const ownerUserId = getPaneUserId(ownerPane);

    await createGroupAndAddPeer(ownerPane, GROUP_NAME, peerUserId);
    await openExplorer(ownerPane);
    await createNoteInContainer(ownerPane, "/", NOTE_TEXT);
    await openExplorer(peerPane);
    const shareBaseline = capturePostShareSyncBaseline();
    await shareContainerWithGroup(ownerPane, "/", GROUP_NAME, "read");
    await clickExplorerRefresh(peerPane);
    await refreshUntil(
      peerPane,
      () => listExplorerContainerItems(peerPane).length > 1,
      "Peer did not discover the custom-group root grant.",
    );
    await waitForExplorerNoteVisible(peerPane, NOTE_TEXT, 20_000);
    await selectExplorerNoteByName(peerPane, NOTE_TEXT);
    await waitForSelectedNoteText(
      peerPane,
      NOTE_TEXT,
      "Peer could not decrypt the initially shared note.",
    );
    await waitForNoPostShareSyncFailures([ownerPane, peerPane], shareBaseline);
    await waitForPrincipalRematerialization();

    await removeGroupMember(ownerPane, GROUP_NAME, peerUserId);
    const readdRequestStart = listProxiedApiRequests().length;
    await addGroupMember(ownerPane, GROUP_NAME, peerUserId);
    await clickExplorerRefresh(peerPane);
    expect(
      listProxiedApiRequests()
        .slice(readdRequestStart)
        .some(
          (request) =>
            request.method === "POST" &&
            request.url.endsWith("/recite") &&
            request.status === 200,
        ),
    ).toBe(true);
    await waitForExplorerNoteVisible(peerPane, NOTE_TEXT, 20_000);
    await selectExplorerNoteByName(peerPane, NOTE_TEXT);
    await waitForSelectedNoteText(
      peerPane,
      NOTE_TEXT,
      "Peer did not regain historical data through the current group head.",
      20_000,
    );

    const ownerRecovery = await downloadPaneRecoveryKey(ownerPane);
    await restorePaneRecoveryKey(peerPane, ownerRecovery);
    await waitForCondition(
      () => getPaneUserId(peerPane) === ownerUserId,
      "Fresh pane did not restore the owner identity",
      20_000,
    );
    await waitForPrincipalRematerialization();
    await openOrgManager(peerPane);
    const ownerWindow = peerPane
      .querySelector<HTMLElement>(".org-manager-main")
      ?.closest<HTMLElement>(".window");
    invariant(ownerWindow, "Expected organization manager window");
    const newGroupDialog = await openWindowMenuDialog({
      dialogName: "New Group",
      itemName: "New Group",
      scope: ownerWindow,
    });
    await interact(() => {
      fireEvent.change(within(newGroupDialog).getByLabelText("Group name"), {
        target: { value: "After rotation" },
      });
    });
    await interact(() => {
      fireEvent.click(
        within(newGroupDialog).getByRole("button", { name: "Create" }),
      );
    });
    await within(peerPane)
      .findByText("After rotation", undefined, { timeout: 15000 })
      .catch(() => {
        throw new Error(
          `create result: ${newGroupDialog.textContent}\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(-20))}`,
        );
      });
  },
  CURRENT_PRINCIPAL_RECOVERY_TIMEOUT_MS,
);
