import { expect } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  requestPath,
  summarizeProxiedApiRequests,
  truncateText,
} from "../dualPaneRequestSummary";
import { listProxiedApiRequests } from "../mswServer";
import { waitForCondition } from "../waitForCondition";
import {
  DUAL_PANE_TEST_TIMEOUT_MS,
  getExplorerSidebarItem,
  getExplorerSidebarItemsByName,
  getExplorerWindowRoot,
  interact,
  listExplorerContainerItems,
  openExplorerViewMenu,
  queryExplorerItemTable,
  SHARED_NOTE_TITLE,
  selectContainerAndWaitForItemTable,
} from "./dualPaneCore";
import { waitForRemoteAttachmentBlob } from "./dualPaneSyncKit";

export async function openExplorer(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  const openExplorerButton = screen.getByRole("button", {
    name: "Explorer",
  });
  await interact(() => {
    fireEvent.click(openExplorerButton);
  });

  await waitFor(
    () => {
      expect(queryExplorerItemTable(pane)).toBeTruthy();
    },
    { timeout: DUAL_PANE_TEST_TIMEOUT_MS },
  );
}

async function openExplorerNewStructuredDocumentRoute(pane: HTMLElement) {
  const explorerWindow = getExplorerWindowRoot(pane);
  await interact(() => {
    fireEvent.click(
      within(explorerWindow).getByRole("menuitem", { name: "File" }),
    );
  });
  const newStructuredDocumentItem = within(explorerWindow).getByRole(
    "menuitem",
    {
      name: "New Document",
    },
  );
  await interact(() => {
    fireEvent.click(newStructuredDocumentItem);
  });
  await waitFor(() => {
    expect(within(pane).getByRole("button", { name: "Note" })).toBeTruthy();
  });
}

export async function createChildContainer(pane: HTMLElement, name: string) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, "/"), {
      clientX: 180,
      clientY: 180,
    });
  });
  // Scope to the context menu: the Explorer toolbar now carries a same-named
  // "Create Child Folder" button whenever a container is active.
  const createChildMenu = document.querySelector<HTMLElement>(".menu");
  invariant(createChildMenu, "explorer context menu not found");
  const createChildButton = within(createChildMenu).getByRole("button", {
    name: "Create Child Folder",
  });
  await interact(() => {
    fireEvent.click(createChildButton);
  });
  const containerNameInput = screen.getByLabelText("Container name");
  invariant(
    containerNameInput instanceof HTMLInputElement,
    "Expected container name input.",
  );
  await waitFor(() => {
    expect(document.activeElement).toBe(containerNameInput);
  });
  await interact(() => {
    fireEvent.change(containerNameInput, {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  });

  await waitForCondition(
    () => getExplorerSidebarItemsByName(pane, name).length > 0,
    `Child container "${name}" was not created.`,
  );
}

export async function createNoteWithAttachment(
  pane: HTMLElement,
  {
    attachmentContents = "peer one attachment",
    attachmentName = "peer-one.png",
    containerName = "/",
    title = SHARED_NOTE_TITLE,
  }: {
    attachmentContents?: string;
    attachmentName?: string;
    containerName?: string;
    title?: string;
  } = {},
) {
  await selectContainerAndWaitForItemTable(pane, containerName);
  await openExplorerNewStructuredDocumentRoute(pane);
  const newNoteButton = await within(pane).findByRole("button", {
    name: "Note",
  });
  await interact(() => {
    fireEvent.click(newNoteButton);
  });

  const editor = await within(pane).findByRole("textbox", {
    name: /Notes editor/u,
  });
  // The explorer's inline note view renders the editor and attachments
  // without the notes mini-app toolbar, so attachments are staged through
  // the hidden file input (and drag/drop) rather than an Attach button. Wait
  // until that input is enabled to know the note document is ready to attach.
  await waitFor(() => {
    const input = pane.querySelector<HTMLInputElement>(
      "input.note-document-file-input",
    );
    invariant(input, "Expected notes file input.");
    expect(input.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.change(editor, {
      target: { value: title },
    });
  });

  const fileInput = pane.querySelector<HTMLInputElement>(
    "input.note-document-file-input",
  );
  invariant(fileInput, "Expected notes file input.");
  const attachment = new File([attachmentContents], attachmentName, {
    type: "image/png",
  });
  await interact(() => {
    fireEvent.change(fileInput, {
      target: { files: [attachment] },
    });
  });

  await waitFor(() => {
    expect(within(pane).getByText(attachmentName)).toBeTruthy();
  });
  await waitForRemoteAttachmentBlob();

  // Return to the container view by re-selecting it in the sidebar (the in-document
  // "Back to Container" toolbar button was removed).
  await selectContainerAndWaitForItemTable(pane, containerName);
}

export async function createNoteInContainer(
  pane: HTMLElement,
  containerName: string,
  title: string,
) {
  await selectContainerAndWaitForItemTable(pane, containerName);
  await openExplorerNewStructuredDocumentRoute(pane);
  const newNoteButton = await within(pane).findByRole("button", {
    name: "Note",
  });
  await interact(() => {
    fireEvent.click(newNoteButton);
  });

  const editor = await within(pane).findByRole("textbox", {
    name: /Notes editor/u,
  });
  const requestStartIndex = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent.change(editor, {
      target: { value: title },
    });
  });

  await waitForCondition(
    () =>
      listProxiedApiRequests()
        .slice(requestStartIndex)
        .some(
          (request) =>
            request.method === "POST" &&
            request.status === 200 &&
            requestPath(request.url) === "/documents",
        ),
    `Created note did not sync before moving its container.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(requestStartIndex))}`,
  );
}

export async function openExplorerContainerInfo(
  pane: HTMLElement,
  name: string,
) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, name), {
      clientX: 200,
      clientY: 200,
    });
  });
  const getInfoMenu = document.querySelector<HTMLElement>(".menu");
  invariant(getInfoMenu, "explorer context menu not found");
  const getInfoButton = within(getInfoMenu).getByRole("button", {
    name: "Get Info",
  });
  await interact(() => {
    fireEvent.click(getInfoButton);
  });

  await within(getExplorerWindowRoot(pane)).findByText("Container Info");
}

function clickAvailableExplorerRefresh(pane: HTMLElement): boolean {
  const explorerWindow = openExplorerViewMenu(pane);
  const refreshButton = within(explorerWindow).queryByRole("menuitem", {
    name: /Refresh/,
  });

  if (refreshButton instanceof HTMLButtonElement && !refreshButton.disabled) {
    fireEvent.click(refreshButton);
    return true;
  }

  return false;
}

export async function clickExplorerRefresh(pane: HTMLElement) {
  const getRefreshButton = () => {
    const explorerWindow = openExplorerViewMenu(pane);
    const refreshButton = within(explorerWindow).getByRole("menuitem", {
      name: "Refresh",
    });
    invariant(
      refreshButton instanceof HTMLButtonElement,
      "Expected explorer refresh button.",
    );
    return refreshButton;
  };

  await waitFor(() => {
    expect(getRefreshButton().disabled).toBe(false);
  });

  await interact(() => {
    fireEvent.click(getRefreshButton());
  });
}

export async function waitForSharedNoteVisible(pane: HTMLElement) {
  await waitForCondition(
    () => getExplorerSidebarItemsByName(pane, SHARED_NOTE_TITLE).length > 0,
    `Peer did not discover shared note "${SHARED_NOTE_TITLE}".\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );
}

export async function waitForExplorerNoteVisible(
  pane: HTMLElement,
  title: string,
  timeoutMs = 10_000,
) {
  await waitForCondition(
    () =>
      getExplorerSidebarItemsByName(pane, title).some((button) =>
        button.classList.contains("explorer-sidebar-item--note"),
      ),
    `Explorer did not discover note "${title}".\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
    timeoutMs,
  );
}

function getNoteEditor(pane: HTMLElement): HTMLTextAreaElement {
  const editor = within(pane).getByRole("textbox", {
    name: /Notes editor/u,
  });
  invariant(
    editor instanceof HTMLTextAreaElement,
    "Expected notes editor textarea.",
  );
  return editor;
}

export async function selectExplorerNoteByName(
  pane: HTMLElement,
  title: string,
) {
  await waitForExplorerNoteVisible(pane, title);
  const noteItem = getExplorerSidebarItemsByName(pane, title).find((button) =>
    button.classList.contains("explorer-sidebar-item--note"),
  );
  invariant(noteItem, `Expected explorer note item "${title}".`);
  await interact(() => {
    fireEvent.click(noteItem);
  });
  await waitFor(() => {
    expect(getNoteEditor(pane)).toBeTruthy();
  });
}

export async function editSelectedNoteText(pane: HTMLElement, text: string) {
  const editor = await within(pane).findByRole("textbox", {
    name: /Notes editor/u,
  });
  invariant(
    editor instanceof HTMLTextAreaElement,
    "Expected notes editor textarea.",
  );

  await interact(() => {
    fireEvent.change(editor, {
      target: { value: text },
    });
  });
  await waitFor(() => {
    expect(editor.value).toBe(text);
  });
}

export async function waitForSelectedNoteText(
  pane: HTMLElement,
  text: string,
  message: string,
  timeoutMs = 15_000,
) {
  await waitForCondition(
    () => getNoteEditor(pane).value === text,
    `${message}\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
    timeoutMs,
  );
}

export async function moveContainer(
  pane: HTMLElement,
  name: string,
  destinationName: string,
) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, name), {
      clientX: 210,
      clientY: 210,
    });
  });
  const moveMenu = document.querySelector<HTMLElement>(".menu");
  invariant(moveMenu, "explorer context menu not found");
  const moveButton = within(moveMenu).getByRole("button", {
    name: "Move",
  });
  await interact(() => {
    fireEvent.click(moveButton);
  });

  // findByRole, not getByRole: the dialog mounts on a state update that can
  // land a tick after the menu click under suite load.
  const dialog = await screen.findByRole("dialog");
  const destinationSelect = within(dialog).getByRole("combobox", {
    name: "Destination container",
  });
  invariant(
    destinationSelect instanceof HTMLButtonElement,
    "Expected destination container dropdown.",
  );
  await waitFor(() => {
    expect(document.activeElement).toBe(destinationSelect);
  });
  await interact(() => {
    fireEvent.click(destinationSelect);
  });
  const destinationOption = await within(dialog).findByRole("option", {
    name: destinationName,
  });
  await interact(() => {
    fireEvent.click(destinationOption);
  });
  await waitFor(() => {
    expect(destinationSelect.textContent).toContain(destinationName);
  });
  await interact(() => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
  });

  await waitForCondition(
    () => screen.queryByRole("dialog") === null,
    "Container move did not finish.",
  );
}

export async function refreshUntil(
  pane: HTMLElement,
  predicate: () => boolean,
  message: string,
  timeoutMs = 10_000,
) {
  await waitForCondition(
    () => {
      if (predicate()) {
        return true;
      }

      clickAvailableExplorerRefresh(pane);
      return false;
    },
    message,
    timeoutMs,
  );
}

export async function selectPeerSharedContainer(
  pane: HTMLElement,
  preferredName: string,
) {
  await refreshUntil(
    pane,
    () => listExplorerContainerItems(pane).length > 1,
    "Peer did not discover a shared child container.",
  );

  const sharedContainer =
    listExplorerContainerItems(pane).find(
      (button) => button.textContent?.trim() === preferredName,
    ) ??
    listExplorerContainerItems(pane).find(
      (button) => button.textContent?.trim() !== "/",
    );

  invariant(sharedContainer, "Expected peer shared container item.");
  await interact(() => {
    fireEvent.click(sharedContainer);
  });
}
