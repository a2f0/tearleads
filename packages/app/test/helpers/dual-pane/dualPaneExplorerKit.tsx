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

  await waitFor(() => {
    expect(queryExplorerItemTable(pane)).toBeTruthy();
  });
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
  const createChildButton = screen.getByRole("button", {
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

export async function createNoteWithAttachment(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(getExplorerSidebarItem(pane, "/"));
  });
  await waitFor(() => {
    expect(
      getExplorerSidebarItem(pane, "/").classList.contains(
        "mini-app-row--selected",
      ),
    ).toBe(true);
  });
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
      target: { value: SHARED_NOTE_TITLE },
    });
  });

  const fileInput = pane.querySelector<HTMLInputElement>(
    "input.note-document-file-input",
  );
  invariant(fileInput, "Expected notes file input.");
  const attachment = new File(["peer one attachment"], "peer-one.png", {
    type: "image/png",
  });
  await interact(() => {
    fireEvent.change(fileInput, {
      target: { files: [attachment] },
    });
  });

  await waitFor(() => {
    expect(within(pane).getByText("peer-one.png")).toBeTruthy();
  });
  await waitForRemoteAttachmentBlob();

  const backButton = within(pane).getByRole("button", {
    name: "Back to Container",
  });
  await interact(() => {
    fireEvent.click(backButton);
  });
  await waitFor(() => {
    expect(queryExplorerItemTable(pane)).toBeTruthy();
  });
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
  const getInfoButton = screen.getByRole("button", {
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
) {
  await waitForCondition(
    () =>
      getExplorerSidebarItemsByName(pane, title).some((button) =>
        button.classList.contains("explorer-sidebar-item--note"),
      ),
    `Explorer did not discover note "${title}".\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
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
  const moveButton = screen.getByRole("button", {
    name: "Move",
  });
  await interact(() => {
    fireEvent.click(moveButton);
  });

  const dialog = screen.getByRole("dialog");
  const destinationSelect = within(dialog).getByLabelText(
    "Destination container",
  );
  invariant(
    destinationSelect instanceof HTMLSelectElement,
    "Expected destination container select.",
  );
  await waitFor(() => {
    expect(document.activeElement).toBe(destinationSelect);
  });
  // Explorer intentionally no longer exposes container ids in move labels, so
  // this helper follows the real user-visible folder name.
  const destinationOptions = Array.from(destinationSelect.options).filter(
    (option) => option.textContent?.trim() === destinationName,
  );
  invariant(
    destinationOptions.length <= 1,
    `Expected one destination option for "${destinationName}", found ${destinationOptions.length}.`,
  );
  const destinationOption = destinationOptions[0];
  invariant(
    destinationOption,
    `Expected destination option for "${destinationName}".`,
  );
  await interact(() => {
    fireEvent.change(destinationSelect, {
      target: { value: destinationOption.value },
    });
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
