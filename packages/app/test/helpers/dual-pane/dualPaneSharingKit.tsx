import { expect } from "bun:test";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { waitForAppTestRuntimeToSettle } from "../appRuntimeIdle";
import {
  requestPath,
  summarizeProxiedApiRequests,
  truncateText,
} from "../dualPaneRequestSummary";
import { listProxiedApiRequests } from "../mswServer";
import { summarizeProxiedApiRequestVolume } from "../proxiedApiRequestBudget";
import { waitForCondition } from "../waitForCondition";
import {
  formatExplorerWindowDebug,
  getExplorerSidebarItem,
  getExplorerWindowRoot,
  interact,
  openWindowMenuDialog,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  queryExplorerItemTable,
} from "./dualPaneCore";

const ORG_MANAGER_ADD_USER_TIMEOUT_MS = 10_000;

async function openExplorerContextMenuInfo() {
  const getInfoMenu = document.querySelector<HTMLElement>(".menu");
  invariant(getInfoMenu, "explorer context menu not found");
  const getInfoButton = within(getInfoMenu).getByRole("button", {
    name: "Get Info",
  });
  await interact(() => {
    fireEvent.click(getInfoButton);
  });
}

export async function openOrgManager(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  const openOrgManagerButton = screen.getByRole("button", {
    name: "Org Manager",
  });
  await interact(() => {
    fireEvent.click(openOrgManagerButton);
  });

  await waitFor(() => {
    expect(within(pane).getByRole("button", { name: "Groups" })).toBeTruthy();
  });
}

export async function shareContainerWithPeer(pane: HTMLElement, name: string) {
  const requestStartIndex = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, name), {
      clientX: 200,
      clientY: 200,
    });
  });
  await openExplorerContextMenuInfo();
  await openContainerInfoSharingTab(pane);
  const shareWithPeerButton = await screen.findByRole(
    "button",
    {
      name: "Share With Peer",
    },
    { timeout: 15_000 },
  );
  await interact(() => {
    fireEvent.click(shareWithPeerButton);
  });

  await waitForCondition(
    () =>
      listProxiedApiRequests()
        .slice(requestStartIndex)
        .some(
          (request) =>
            request.method === "POST" &&
            request.status === 200 &&
            request.url.endsWith("/share"),
        ),
    `Container share did not finish.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );
}

export async function openContainerInfoSharingTab(pane: HTMLElement) {
  // Container info opens on General; these flows need the explicit Sharing tab
  // so the test follows the same navigation a user performs before sharing.
  const sharingTab = await within(pane).findByRole("tab", {
    name: "Sharing",
  });
  invariant(sharingTab instanceof HTMLElement, "Expected sharing tab.");
  await interact(() => {
    fireEvent.click(sharingTab);
  });
  await waitFor(() => {
    expect(sharingTab.getAttribute("aria-selected")).toBe("true");
  });
}

export async function clickShareWithPeer(pane: HTMLElement) {
  const shareWithPeerButton = await within(pane).findByRole("button", {
    name: "Share With Peer",
  });
  invariant(
    shareWithPeerButton instanceof HTMLButtonElement,
    "Expected share with peer button.",
  );
  await waitFor(() => {
    expect(shareWithPeerButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(shareWithPeerButton);
  });
}

export async function shareContainerWithGroup(
  pane: HTMLElement,
  name: string,
  groupName: string,
  accessLevel: "read" | "write" | "admin",
): Promise<string> {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, name), {
      clientX: 200,
      clientY: 200,
    });
  });
  await openExplorerContextMenuInfo();
  await openContainerInfoSharingTab(pane);

  const initialGroupSelect = await within(pane).findByRole("combobox", {
    name: "Group",
  });
  invariant(
    initialGroupSelect instanceof HTMLButtonElement,
    "Expected group select.",
  );
  await waitFor(() => {
    expect(initialGroupSelect.disabled).toBe(false);
  });
  await act(async () => {
    await waitForAppTestRuntimeToSettle({
      apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
      timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    });
  });

  const groupSelect = within(pane).getByRole("combobox", { name: "Group" });
  invariant(groupSelect instanceof HTMLButtonElement, "Expected group select.");
  const permissionSelect = within(pane).getByRole("combobox", {
    name: "Permission",
  });
  invariant(
    permissionSelect instanceof HTMLButtonElement,
    "Expected permission select.",
  );
  await interact(() => {
    fireEvent.click(groupSelect);
  });
  const selectedGroupOption = await within(pane).findByRole("option", {
    name: groupName,
  });
  invariant(selectedGroupOption, `Expected group option "${groupName}".`);
  const selectedGroupId = selectedGroupOption.getAttribute("data-value");
  invariant(selectedGroupId, `Expected group id for "${groupName}".`);

  await interact(() => {
    fireEvent.click(selectedGroupOption);
  });
  await waitFor(() => {
    expect(groupSelect.textContent).toContain(groupName);
    expect(permissionSelect.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(permissionSelect);
  });
  const accessLevelOption = await within(pane).findByRole("option", {
    name: new RegExp(`^${accessLevel}$`, "i"),
  });
  await interact(() => {
    fireEvent.click(accessLevelOption);
  });
  await waitFor(() => {
    expect(permissionSelect.textContent).toContain(accessLevel);
  });

  const shareButton = within(pane).getByRole("button", { name: "Share" });
  invariant(shareButton instanceof HTMLButtonElement, "Expected share button.");
  await waitFor(() => {
    expect(shareButton.disabled).toBe(false);
  });
  const requestStartIndex = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent.click(shareButton);
  });
  await waitForCondition(
    () =>
      listProxiedApiRequests()
        .slice(requestStartIndex)
        .some(
          (request) =>
            request.method === "POST" &&
            request.status === 200 &&
            requestPath(request.url).endsWith("/share"),
        ),
    `Container group share did not finish.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(requestStartIndex))}\npane=${truncateText(pane.textContent ?? "")}`,
    15_000,
  );

  // Return to the container view by re-selecting it in the sidebar (the
  // "Back to Container" toolbar button was removed).
  await interact(() => {
    fireEvent.click(getExplorerSidebarItem(pane, name));
  });
  await waitForCondition(
    () => Boolean(queryExplorerItemTable(pane)),
    `Container group share route did not return to the container.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );

  return selectedGroupId;
}

export async function addPeerToAdminsGroup(
  pane: HTMLElement,
  peerUserId: string,
  onBeforeAdd?: () => void,
) {
  // Roster-first flows already have Org Manager open on the imported user.
  // Reopening it would stack a second window and make its navigation ambiguous.
  if (within(pane).queryAllByRole("button", { name: "Groups" }).length === 0) {
    await openOrgManager(pane);
  }

  const groupsButton = within(pane).getAllByRole("button", {
    name: "Groups",
  })[0];
  invariant(groupsButton, "Expected org manager Groups button.");
  await interact(() => {
    fireEvent.click(groupsButton);
  });

  const adminsButton = await within(pane).findByText("Admins");
  await interact(() => {
    fireEvent.click(adminsButton);
  });

  const userIdInput = await within(pane).findByLabelText("User ID");
  invariant(
    userIdInput instanceof HTMLInputElement,
    "Expected org manager user id input.",
  );
  const addButton = within(pane).getByRole("button", { name: "Add" });
  invariant(addButton instanceof HTMLButtonElement, "Expected add button.");

  await waitFor(() => {
    expect(userIdInput.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.change(userIdInput, {
      target: { value: peerUserId },
    });
  });
  await waitFor(() => {
    expect(addButton.disabled).toBe(false);
  });
  onBeforeAdd?.();
  await interact(() => {
    fireEvent.click(addButton);
  });

  await waitFor(
    () => {
      expect(userIdInput.value).toBe("");
    },
    { timeout: ORG_MANAGER_ADD_USER_TIMEOUT_MS },
  );
  await waitForCondition(
    () =>
      Array.from(pane.querySelectorAll("strong")).some(
        (element) => element.getAttribute("title") === peerUserId,
      ),
    `Peer ${peerUserId} did not appear in Admins.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );
  await act(async () => {
    await waitForAppTestRuntimeToSettle({
      apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
      timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    });
  });
}

export async function createGroupAndAddPeer(
  pane: HTMLElement,
  groupName: string,
  peerUserId: string,
) {
  await openOrgManager(pane);

  const dialog = await openWindowMenuDialog({
    dialogName: "New Group",
    itemName: "New Group",
    scope: pane,
    timeoutMs: ORG_MANAGER_ADD_USER_TIMEOUT_MS,
  });
  const groupNameInput = within(dialog).getByLabelText("Group name");
  invariant(
    groupNameInput instanceof HTMLInputElement,
    "Expected group name input.",
  );
  const createButton = within(dialog).getByRole("button", { name: "Create" });
  invariant(
    createButton instanceof HTMLButtonElement,
    "Expected create group button.",
  );

  await waitFor(() => {
    expect(groupNameInput.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.change(groupNameInput, {
      target: { value: groupName },
    });
  });
  await waitFor(() => {
    expect(createButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(createButton);
  });

  await within(pane).findByText(groupName);
  const userIdInput = await within(pane).findByLabelText("User ID");
  invariant(
    userIdInput instanceof HTMLInputElement,
    "Expected org manager user id input.",
  );
  const addButton = within(pane).getByRole("button", { name: "Add" });
  invariant(addButton instanceof HTMLButtonElement, "Expected add button.");

  await waitFor(() => {
    expect(userIdInput.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.change(userIdInput, {
      target: { value: peerUserId },
    });
  });
  await waitFor(() => {
    expect(addButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(addButton);
  });

  await waitFor(
    () => {
      expect(userIdInput.value).toBe("");
    },
    { timeout: ORG_MANAGER_ADD_USER_TIMEOUT_MS },
  );
  await waitForCondition(
    () =>
      Array.from(pane.querySelectorAll("strong")).some(
        (element) => element.getAttribute("title") === peerUserId,
      ),
    `Peer ${peerUserId} did not appear in group "${groupName}".\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );
}

export async function createOrganizationGroup(
  pane: HTMLElement,
  groupName: string,
) {
  if (within(pane).queryAllByRole("button", { name: "Groups" }).length === 0) {
    await openOrgManager(pane);
  }

  const dialog = await openWindowMenuDialog({
    dialogName: "New Group",
    itemName: "New Group",
    scope: pane,
  });
  const groupNameInput = within(dialog).getByLabelText("Group name");
  invariant(
    groupNameInput instanceof HTMLInputElement,
    "Expected group name input.",
  );
  const createButton = within(dialog).getByRole("button", { name: "Create" });
  invariant(
    createButton instanceof HTMLButtonElement,
    "Expected create group button.",
  );

  await waitFor(() => {
    expect(groupNameInput.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.change(groupNameInput, {
      target: { value: groupName },
    });
  });
  await waitFor(() => {
    expect(createButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(createButton);
  });

  await within(pane).findByText(groupName);
  await within(pane).findByLabelText("User ID");
}

export async function findExplorerInfoGrantRow(
  pane: HTMLElement,
  groupId: string,
  groupName: string,
  accessLevel: string,
): Promise<HTMLTableRowElement> {
  let row: HTMLTableRowElement | null = null;
  await waitForCondition(
    () => {
      const explorerWindow = getExplorerWindowRoot(pane);
      row =
        Array.from(
          explorerWindow.querySelectorAll<HTMLTableRowElement>("tr"),
        ).find((candidate) => {
          const text = candidate.textContent ?? "";
          const hasGroupSubject =
            text.includes(groupName) ||
            Array.from(candidate.querySelectorAll("td")).some(
              (cell) => cell.getAttribute("title") === groupId,
            );
          return hasGroupSubject && text.includes(accessLevel);
        }) ?? null;
      return row !== null;
    },
    `Explorer info grant row did not appear.\n${formatExplorerWindowDebug(pane)}\nrequest volume=\n${summarizeProxiedApiRequestVolume(listProxiedApiRequests())}`,
    15_000,
  );

  invariant(row, `Expected grant row for "${groupName}".`);
  return row;
}
