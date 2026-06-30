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
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  queryExplorerItemTable,
} from "./dualPaneCore";

const ORG_MANAGER_ADD_USER_TIMEOUT_MS = 10_000;

export async function openOrgManager(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  const openOrgManagerButton = screen.getByRole("button", {
    name: "Open Org Manager",
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
  const getInfoButton = screen.getByRole("button", {
    name: "Get Info",
  });
  await interact(() => {
    fireEvent.click(getInfoButton);
  });
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
  const getInfoButton = screen.getByRole("button", {
    name: "Get Info",
  });
  await interact(() => {
    fireEvent.click(getInfoButton);
  });
  await openContainerInfoSharingTab(pane);

  const initialGroupSelect = await within(pane).findByLabelText("Group");
  invariant(
    initialGroupSelect instanceof HTMLSelectElement,
    "Expected group select.",
  );
  let groupOption: HTMLOptionElement | undefined;
  await waitFor(() => {
    groupOption = Array.from(initialGroupSelect.options).find(
      (option) => option.textContent?.trim() === groupName,
    );
    expect(groupOption).toBeTruthy();
  });
  await waitFor(() => {
    expect(initialGroupSelect.disabled).toBe(false);
  });
  await act(async () => {
    await waitForAppTestRuntimeToSettle({
      apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
      timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    });
  });

  const groupSelect = within(pane).getByLabelText("Group");
  invariant(groupSelect instanceof HTMLSelectElement, "Expected group select.");
  const permissionSelect = within(pane).getByLabelText("Permission");
  invariant(
    permissionSelect instanceof HTMLSelectElement,
    "Expected permission select.",
  );
  const selectedGroupOption = Array.from(groupSelect.options).find(
    (option) => option.textContent?.trim() === groupName,
  );
  invariant(selectedGroupOption, `Expected group option "${groupName}".`);

  await interact(() => {
    fireEvent.change(groupSelect, {
      target: { value: selectedGroupOption.value },
    });
  });
  await waitFor(() => {
    expect(groupSelect.value).toBe(selectedGroupOption.value);
    expect(permissionSelect.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.change(permissionSelect, {
      target: { value: accessLevel },
    });
  });
  await waitFor(() => {
    expect(permissionSelect.value).toBe(accessLevel);
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

  const backButton = within(pane).getByRole("button", {
    name: "Back to Container",
  });
  invariant(
    backButton instanceof HTMLButtonElement,
    "Expected back to container button.",
  );
  await waitFor(() => {
    expect(backButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(backButton);
  });
  await waitForCondition(
    () => Boolean(queryExplorerItemTable(pane)),
    `Container group share route did not return to the container.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );

  return selectedGroupOption.value;
}

export async function addPeerToAdminsGroup(
  pane: HTMLElement,
  peerUserId: string,
) {
  await openOrgManager(pane);

  const groupsButton = within(pane).getByRole("button", { name: "Groups" });
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

  const fileMenu = within(pane).getByRole("menuitem", { name: "File" });
  await interact(() => {
    fireEvent.click(fileMenu);
  });
  const newGroupItem = within(pane).getByRole("menuitem", {
    name: "New Group",
  });
  await interact(() => {
    fireEvent.click(newGroupItem);
  });
  const dialog = within(pane).getByRole("dialog", {
    name: "New Group",
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
  await openOrgManager(pane);

  const fileMenu = within(pane).getByRole("menuitem", { name: "File" });
  await interact(() => {
    fireEvent.click(fileMenu);
  });
  const newGroupItem = within(pane).getByRole("menuitem", {
    name: "New Group",
  });
  await interact(() => {
    fireEvent.click(newGroupItem);
  });
  const dialog = within(pane).getByRole("dialog", {
    name: "New Group",
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
