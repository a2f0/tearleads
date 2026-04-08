import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { MockWorker } from "../../../test/helpers/mockWorker";
import {
  listProxiedApiRequests,
  resetMockServer,
  useRealApiHandlers,
  wsUrl,
} from "../../../test/helpers/mswServer";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createAppDatabaseWorker } from "../../db/sqliteWorker";
import { AppHostConfig } from "../../host/AppHostConfig";
import { DualPaneProvider, PaneSideProvider } from "./DualPaneProvider";
import { Pane } from "./Pane";
import { PaneProvider } from "./PaneProvider";

afterEach(async () => {
  cleanup();
  await resetMockServer();
});

async function interact(operation: () => void): Promise<void> {
  await act(async () => {
    operation();
  });
}

function renderDualPane() {
  const hostConfig = new AppHostConfig("http://localhost:3001", wsUrl, () =>
    createAppDatabaseWorker(MockWorker),
  );

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <Pane className="pane pane-left" />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
          <Pane className="pane pane-right" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

function getPaneRoot(
  view: ReturnType<typeof renderDualPane>,
  side: "left" | "right",
): HTMLElement {
  const pane = view.container.querySelector<HTMLElement>(`.pane-${side}`);
  invariant(pane, `Expected ${side} pane root.`);
  return pane;
}

async function generateAndUploadKeyPair(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(within(pane).getByRole("button", { name: "Menu" }));
  });
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Generate Key Pair" }),
    ).toBeTruthy();
  });
  await interact(() => {
    fireEvent.click(screen.getByRole("button", { name: "Generate Key Pair" }));
  });

  await waitFor(() => {
    expect(within(pane).getByText(/sqlite worker: ready/)).toBeTruthy();
    expect(within(pane).queryByText(/publicKey: none/)).toBeNull();
  });

  await interact(() => {
    fireEvent.click(within(pane).getByRole("button", { name: "Menu" }));
  });
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Upload Public Key" }),
    ).toBeTruthy();
  });
  await interact(() => {
    fireEvent.click(screen.getByRole("button", { name: "Upload Public Key" }));
  });

  await waitForCondition(
    () =>
      !pane.textContent?.includes("userId: none") &&
      !pane.textContent?.includes("session: none"),
    "Pane did not finish registration/authentication.",
  );
}

async function openExplorer(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Open Explorer" })).toBeTruthy();
  });
  await interact(() => {
    fireEvent.click(screen.getByRole("button", { name: "Open Explorer" }));
  });

  await waitFor(() => {
    expect(within(pane).getByRole("button", { name: "New Note" })).toBeTruthy();
  });
}

function getExplorerSidebarItem(
  pane: HTMLElement,
  name: string,
): HTMLButtonElement {
  const item = Array.from(
    pane.querySelectorAll<HTMLButtonElement>("button.explorer-sidebar-item"),
  ).find((button) => button.textContent?.trim() === name);

  invariant(item, `Expected explorer sidebar item "${name}".`);
  return item;
}

function listExplorerContainerItems(pane: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    pane.querySelectorAll<HTMLButtonElement>("button.explorer-sidebar-item"),
  ).filter(
    (button) => !button.classList.contains("explorer-sidebar-item--note"),
  );
}

function listExplorerNoteItems(pane: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    pane.querySelectorAll<HTMLButtonElement>(
      "button.explorer-sidebar-item--note",
    ),
  );
}

async function createChildContainer(pane: HTMLElement, name: string) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, "/"), {
      clientX: 180,
      clientY: 180,
    });
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Create Child" })).toBeTruthy();
  });
  await interact(() => {
    fireEvent.click(screen.getByRole("button", { name: "Create Child" }));
  });
  await interact(() => {
    fireEvent.change(screen.getByLabelText("Container name"), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  });

  await waitFor(() => {
    expect(getExplorerSidebarItem(pane, name)).toBeTruthy();
  });
}

async function shareContainerWithPeer(pane: HTMLElement, name: string) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, name), {
      clientX: 200,
      clientY: 200,
    });
  });
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Share With Peer" }),
    ).toBeTruthy();
  });
  await interact(() => {
    fireEvent.click(screen.getByRole("button", { name: "Share With Peer" }));
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
  await interact(() => {
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
  });

  await waitForCondition(
    () => screen.queryByRole("dialog") === null,
    "Container share did not finish.",
  );
}

function createFileList(file: File): FileList {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  return dataTransfer.files;
}

async function createInlineNoteWithAttachment(
  pane: HTMLElement,
  text: string,
  fileName: string,
) {
  await interact(() => {
    fireEvent.click(within(pane).getByRole("button", { name: "New Note" }));
  });

  await waitFor(() => {
    expect(
      within(pane).getByRole("button", { name: "Back to Container" }),
    ).toBeTruthy();
    expect(
      within(pane).getByRole("button", { name: "Attach File" }),
    ).toBeTruthy();
  });

  const editor = await within(pane).findByRole("textbox", {
    name: /Notes editor/,
  });
  invariant(editor instanceof HTMLTextAreaElement, "Expected notes editor.");
  await waitFor(() => {
    expect(editor).toBeTruthy();
    expect(editor).toHaveProperty("disabled", false);
  });
  await interact(() => {
    fireEvent.change(editor, { target: { value: text } });
  });
  await waitFor(() => {
    expect(editor.value).toBe(text);
  });

  let fileInput: HTMLInputElement | null = null;
  await waitFor(() => {
    fileInput = pane.querySelector<HTMLInputElement>("input.notes-file-input");
    expect(fileInput).toBeTruthy();
  });
  invariant(fileInput, "Expected notes file input.");
  const attachedFileInput = fileInput;
  const file = new File([new Uint8Array([1, 2, 3, 4])], fileName, {
    type: "image/png",
  });
  Object.defineProperty(attachedFileInput, "files", {
    configurable: true,
    value: createFileList(file),
  });

  await interact(() => {
    fireEvent.change(attachedFileInput);
  });

  await waitFor(() => {
    expect(within(pane).getByText(fileName)).toBeTruthy();
  });
}

async function waitForInlineNoteToSettle(
  pane: HTMLElement,
  noteTitle: string,
  attachmentName: string,
): Promise<string> {
  await waitFor(
    () => {
      expect(within(pane).getByDisplayValue(noteTitle)).toBeTruthy();
      expect(within(pane).getByText(attachmentName)).toBeTruthy();
    },
    { timeout: 10_000 },
  );

  const summarizeRequests = () =>
    listProxiedApiRequests()
      .map(
        (request) =>
          `${request.method} ${request.status} ${request.url}\nauthorization=${request.authorization ?? "null"}\nrequest=${request.requestBody ?? "null"}\nresponse=${request.responseBody}`,
      )
      .join("\n");

  await waitForCondition(
    () =>
      listProxiedApiRequests().some((request) => {
        return (
          request.status === 200 &&
          /\/documents\/[0-9a-f-]+\/commit-change$/u.test(request.url)
        );
      }),
    `Note did not complete a successful remote attachment commit.\npane=${pane.textContent ?? ""}\nrequests=\n${summarizeRequests()}`,
  );

  const createdCommitRequest = [...listProxiedApiRequests()]
    .reverse()
    .find((request) => {
      return (
        request.status === 200 &&
        /\/documents\/[0-9a-f-]+\/commit-change$/u.test(request.url)
      );
    });
  const createdDocumentId =
    createdCommitRequest?.url.match(
      /\/documents\/([0-9a-f-]+)\/commit-change$/u,
    )?.[1] ?? null;
  invariant(createdDocumentId, "Expected committed note document id.");

  return createdDocumentId;
}

async function refreshUntil(
  pane: HTMLElement,
  predicate: () => boolean,
  message: string,
) {
  await waitFor(() => {
    if (predicate()) {
      return;
    }

    const refreshButton = within(pane).queryByRole("button", {
      name: /Refresh/,
    });

    if (refreshButton instanceof HTMLButtonElement && !refreshButton.disabled) {
      fireEvent.click(refreshButton);
    }

    throw new Error(message);
  });
}

async function selectPeerSharedContainer(
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

async function openPeerNoteAndAssertAttachment(
  pane: HTMLElement,
  containerName: string,
  documentId: string,
  noteTitle: string,
  attachmentName: string,
) {
  await selectPeerSharedContainer(pane, containerName);

  const relevantRequests = () =>
    listProxiedApiRequests()
      .filter((request) => request.url.includes(documentId))
      .map(
        (request) =>
          `${request.method} ${request.status} ${request.url}\nauthorization=${request.authorization ?? "null"}\nrequest=${request.requestBody ?? "null"}\nresponse=${request.responseBody}`,
      )
      .join("\n");

  await refreshUntil(
    pane,
    () => listExplorerNoteItems(pane).length > 0,
    "Peer did not discover any note in the shared container.",
  );

  const preferredNoteItem =
    listExplorerNoteItems(pane).find(
      (button) => button.getAttribute("data-note-id") === documentId,
    ) ??
    listExplorerNoteItems(pane).find(
      (button) => button.textContent?.trim() === noteTitle,
    ) ??
    listExplorerNoteItems(pane)[0];
  invariant(preferredNoteItem, "Expected peer note sidebar item.");
  await interact(() => {
    fireEvent.click(preferredNoteItem);
  });

  await waitFor(() => {
    expect(
      within(pane).getByRole("button", { name: "Back to Container" }),
    ).toBeTruthy();
  });

  await waitForCondition(
    () => {
      return (
        Array.from(
          pane.querySelectorAll<HTMLTextAreaElement>("textarea.notes-editor"),
        ).some((editor) => editor.value === noteTitle) &&
        pane.textContent?.includes(attachmentName) === true
      );
    },
    `Peer did not hydrate note "${noteTitle}" and attachment "${attachmentName}". Requests:\n${relevantRequests()}\npane=${pane.textContent ?? ""}`,
  );

  await waitFor(() => {
    expect(within(pane).getByDisplayValue(noteTitle)).toBeTruthy();
    expect(within(pane).getByText(attachmentName)).toBeTruthy();
    expect(within(pane).getByAltText(attachmentName)).toBeTruthy();
  });
}

test("dual panes can share a container and refresh peer discovery", async () => {
  useRealApiHandlers();
  const view = renderDualPane();
  const leftPane = getPaneRoot(view, "left");
  const rightPane = getPaneRoot(view, "right");

  await generateAndUploadKeyPair(leftPane);
  await generateAndUploadKeyPair(rightPane);
  await waitForCondition(
    () =>
      !leftPane.textContent?.includes("peerUserId: none") &&
      !rightPane.textContent?.includes("peerUserId: none"),
    "Dual pane peer user ids did not propagate.",
  );

  await openExplorer(leftPane);
  await openExplorer(rightPane);

  await createChildContainer(leftPane, "Shared");
  await shareContainerWithPeer(leftPane, "Shared");
  await selectPeerSharedContainer(rightPane, "Shared");

  expect(listExplorerContainerItems(rightPane).length).toBeGreaterThan(1);
});

test("dual panes can share a container and refresh a post-share note with an image attachment once current-epoch document recipient envelopes are materialized", async () => {
  useRealApiHandlers();
  const view = renderDualPane();
  const leftPane = getPaneRoot(view, "left");
  const rightPane = getPaneRoot(view, "right");

  await generateAndUploadKeyPair(leftPane);
  await generateAndUploadKeyPair(rightPane);
  await waitForCondition(
    () =>
      !leftPane.textContent?.includes("peerUserId: none") &&
      !rightPane.textContent?.includes("peerUserId: none"),
    "Dual pane peer user ids did not propagate.",
  );

  await openExplorer(leftPane);
  await openExplorer(rightPane);

  await createChildContainer(leftPane, "Shared");
  await interact(() => {
    fireEvent.click(getExplorerSidebarItem(leftPane, "Shared"));
  });

  await shareContainerWithPeer(leftPane, "Shared");
  await selectPeerSharedContainer(rightPane, "Shared");
  await interact(() => {
    fireEvent.click(getExplorerSidebarItem(leftPane, "Shared"));
  });

  await createInlineNoteWithAttachment(
    leftPane,
    "After share note",
    "after-share.png",
  );
  const createdDocumentId = await waitForInlineNoteToSettle(
    leftPane,
    "After share note",
    "after-share.png",
  );
  await openPeerNoteAndAssertAttachment(
    rightPane,
    "Shared",
    createdDocumentId,
    "After share note",
    "after-share.png",
  );
});
