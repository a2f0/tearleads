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
import { useEffect, useRef } from "react";
import { MockWorker } from "../../../test/helpers/mockWorker";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
  wsUrl,
} from "../../../test/helpers/mswServer";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { createAppDatabaseWorker } from "../../db/sqliteWorker";
import { AppHostConfig } from "../../host/AppHostConfig";
import { usePersona } from "../../persona/PersonaProvider";
import { useRegisterCurrentPersona } from "../../persona/useRegisterCurrentPersona";
import { DualPaneProvider, PaneSideProvider } from "./DualPaneProvider";
import { Pane } from "./Pane";
import { PaneProvider } from "./PaneProvider";

const DUAL_PANE_TEST_TIMEOUT_MS = 10_000;

afterEach(async () => {
  cleanup();
  await resetMockServer();
});

async function interact(operation: () => void): Promise<void> {
  await act(async () => {
    operation();
  });
}

function PaneAutoProvisioner() {
  const { status } = useDatabase();
  const { containerId, userId } = useCryptoSession();
  const { generateKey, signingKeyPair } = usePersona();
  const { canRegisterCurrentPersona, registerCurrentPersona } =
    useRegisterCurrentPersona();
  const registrationInFlight = useRef(false);

  useEffect(() => {
    if (signingKeyPair === null) {
      generateKey();
    }
  }, [generateKey, signingKeyPair]);

  useEffect(() => {
    if (
      status !== "ready" ||
      containerId === null ||
      userId !== null ||
      !canRegisterCurrentPersona ||
      registrationInFlight.current
    ) {
      return;
    }

    registrationInFlight.current = true;
    void registerCurrentPersona().finally(() => {
      registrationInFlight.current = false;
    });
  }, [
    canRegisterCurrentPersona,
    containerId,
    registerCurrentPersona,
    status,
    userId,
  ]);

  return null;
}

function renderDualPane() {
  const hostConfig = new AppHostConfig("http://localhost:3001", wsUrl, () =>
    createAppDatabaseWorker(MockWorker),
  );

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <PaneAutoProvisioner />
          <Pane className="pane pane-left" />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
          <PaneAutoProvisioner />
          <Pane className="pane pane-right" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

function renderSinglePane() {
  const hostConfig = new AppHostConfig("http://localhost:3001", wsUrl, () =>
    createAppDatabaseWorker(MockWorker),
  );

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <PaneAutoProvisioner />
          <Pane className="pane pane-left" />
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

async function openExplorer(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  const openExplorerButton = await screen.findByRole("button", {
    name: "Open Explorer",
  });
  await interact(() => {
    fireEvent.click(openExplorerButton);
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

function listExplorerNoteItemsInContainer(
  pane: HTMLElement,
  containerName: string,
): HTMLButtonElement[] {
  const rows = Array.from(
    pane.querySelectorAll<HTMLElement>(".explorer-sidebar-row"),
  );
  const containerButton = getExplorerSidebarItem(pane, containerName);
  const containerRow = containerButton.closest<HTMLElement>(
    ".explorer-sidebar-row",
  );
  invariant(
    containerRow,
    `Expected explorer sidebar row for "${containerName}".`,
  );
  const containerRowIndex = rows.indexOf(containerRow);
  invariant(
    containerRowIndex >= 0,
    `Expected explorer sidebar row index for "${containerName}".`,
  );
  const containerIndent = containerRow.style.paddingLeft;
  const noteItems: HTMLButtonElement[] = [];

  for (const row of rows.slice(containerRowIndex + 1)) {
    const button = row.querySelector<HTMLButtonElement>(
      "button.explorer-sidebar-item",
    );
    if (!button) {
      continue;
    }

    const isNoteButton = button.classList.contains(
      "explorer-sidebar-item--note",
    );
    if (!isNoteButton && row.style.paddingLeft === containerIndent) {
      break;
    }

    if (isNoteButton) {
      noteItems.push(button);
    }
  }

  return noteItems;
}

function getExplorerNoteItemInContainer(
  pane: HTMLElement,
  containerName: string,
  noteTitle: string,
): HTMLButtonElement {
  const noteItem = listExplorerNoteItemsInContainer(pane, containerName).find(
    (button) => button.textContent?.trim() === noteTitle,
  );
  invariant(
    noteItem,
    `Expected note "${noteTitle}" under container "${containerName}".`,
  );
  return noteItem;
}

async function createChildContainer(pane: HTMLElement, name: string) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, "/"), {
      clientX: 180,
      clientY: 180,
    });
  });
  const createChildButton = await screen.findByRole("button", {
    name: "Create Child",
  });
  await interact(() => {
    fireEvent.click(createChildButton);
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
  const shareWithPeerButton = await screen.findByRole("button", {
    name: "Share With Peer",
  });
  await interact(() => {
    fireEvent.click(shareWithPeerButton);
  });
  const shareButton = await screen.findByRole("button", { name: "Share" });
  await interact(() => {
    fireEvent.click(shareButton);
  });

  await waitForCondition(
    () => screen.queryByRole("dialog") === null,
    "Container share did not finish.",
  );
}

async function selectContainerAndReadId(
  pane: HTMLElement,
  name: string,
): Promise<string> {
  await interact(() => {
    fireEvent.click(getExplorerSidebarItem(pane, name));
  });

  await waitFor(() => {
    expect(within(pane).getByText(/^ID:/u)).toBeTruthy();
  });

  const idLine = within(pane).getByText(/^ID:/u).textContent ?? "";
  const containerId = idLine.replace(/^ID:\s*/u, "").trim();
  invariant(containerId.length > 0, `Expected explorer ID for "${name}".`);
  return containerId;
}

async function waitForSinglePaneProvisioning(pane: HTMLElement) {
  await waitForCondition(
    () =>
      !pane.textContent?.includes("userId: none") &&
      !pane.textContent?.includes("session: none"),
    "Left pane identity did not finish provisioning.",
  );
}

async function waitForDualPaneProvisioning(
  leftPane: HTMLElement,
  rightPane: HTMLElement,
) {
  await waitForCondition(
    () =>
      !leftPane.textContent?.includes("userId: none") &&
      !leftPane.textContent?.includes("session: none") &&
      !rightPane.textContent?.includes("userId: none") &&
      !rightPane.textContent?.includes("session: none") &&
      !leftPane.textContent?.includes("peerUserId: none") &&
      !rightPane.textContent?.includes("peerUserId: none"),
    "Dual pane identities did not finish provisioning.",
  );
}

async function moveContainer(
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
  const moveButton = await screen.findByRole("button", {
    name: "Move",
  });
  await interact(() => {
    fireEvent.click(moveButton);
  });

  const dialog = await screen.findByRole("dialog");
  const destinationSelect = within(dialog).getByLabelText(
    "Destination container",
  );
  invariant(
    destinationSelect instanceof HTMLSelectElement,
    "Expected destination container select.",
  );
  const destinationOption = Array.from(destinationSelect.options).find(
    (option) => option.textContent?.startsWith(`${destinationName} (`),
  );
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

async function moveOpenNoteToContainer(
  pane: HTMLElement,
  destinationName: string,
) {
  await interact(() => {
    fireEvent.click(within(pane).getByRole("button", { name: "Move" }));
  });

  const dialog = await screen.findByRole("dialog");
  const destinationSelect = within(dialog).getByLabelText(
    "Destination container",
  );
  invariant(
    destinationSelect instanceof HTMLSelectElement,
    "Expected note destination container select.",
  );
  const destinationOption = Array.from(destinationSelect.options).find(
    (option) => option.textContent?.startsWith(`${destinationName} (`),
  );
  invariant(
    destinationOption,
    `Expected note destination option for "${destinationName}".`,
  );

  await interact(() => {
    fireEvent.change(destinationSelect, {
      target: { value: destinationOption.value },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
  });

  const summarizeRequests = () =>
    listProxiedApiRequests()
      .map(
        (request) =>
          `${request.method} ${request.status} ${request.url}\nauthorization=${request.authorization ?? "null"}\nrequest=${request.requestBody ?? "null"}\nresponse=${request.responseBody}`,
      )
      .join("\n");

  await waitForCondition(
    () => screen.queryByRole("dialog") === null,
    `Note move did not finish.\nrequests=\n${summarizeRequests()}\npane=${pane.textContent ?? ""}`,
  );
}

async function linkOpenNoteToContainer(
  pane: HTMLElement,
  destinationName: string,
) {
  await waitFor(() => {
    const linkButton = within(pane).getByRole("button", { name: "Link" });
    expect(linkButton).toHaveProperty("disabled", false);
  });

  await interact(() => {
    fireEvent.click(within(pane).getByRole("button", { name: "Link" }));
  });

  const dialog = await screen.findByRole("dialog");
  const destinationSelect = within(dialog).getByLabelText(
    "Destination container",
  );
  invariant(
    destinationSelect instanceof HTMLSelectElement,
    "Expected note link destination container select.",
  );
  const destinationOption = Array.from(destinationSelect.options).find(
    (option) => option.textContent?.startsWith(`${destinationName} (`),
  );
  invariant(
    destinationOption,
    `Expected note link destination option for "${destinationName}".`,
  );

  await interact(() => {
    fireEvent.change(destinationSelect, {
      target: { value: destinationOption.value },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Link" }));
  });

  await waitForCondition(
    () => screen.queryByRole("dialog") === null,
    `Note link did not finish.\npane=${pane.textContent ?? ""}`,
  );
}

async function activateOpenNoteInLinkedContainer(
  pane: HTMLElement,
  destinationName: string,
) {
  await interact(() => {
    fireEvent.click(
      within(pane).getByRole("button", {
        name: `Make linked container ${destinationName} active`,
      }),
    );
  });
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

async function createInlineDriverLicense(
  pane: HTMLElement,
  licenseId: string,
  expirationDate: string,
) {
  await interact(() => {
    fireEvent.click(
      within(pane).getByRole("button", { name: "New Driver's License" }),
    );
  });

  await waitFor(() => {
    expect(
      within(pane).getByRole("button", { name: "Back to Container" }),
    ).toBeTruthy();
    expect(
      within(pane).getByLabelText("Driver's license ID number"),
    ).toBeTruthy();
    expect(
      within(pane).getByLabelText("Driver's license expiration date"),
    ).toBeTruthy();
  });

  const licenseIdInput = within(pane).getByLabelText(
    "Driver's license ID number",
  );
  const expirationDateInput = within(pane).getByLabelText(
    "Driver's license expiration date",
  );
  invariant(
    licenseIdInput instanceof HTMLInputElement,
    "Expected driver's license ID input.",
  );
  invariant(
    expirationDateInput instanceof HTMLInputElement,
    "Expected driver's license expiration date input.",
  );

  await interact(() => {
    fireEvent.change(licenseIdInput, { target: { value: licenseId } });
    fireEvent.change(expirationDateInput, {
      target: { value: expirationDate },
    });
  });

  await waitFor(() => {
    expect(licenseIdInput.value).toBe(licenseId);
    expect(expirationDateInput.value).toBe(expirationDate);
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

async function waitForInlineDriverLicenseToSettle(
  pane: HTMLElement,
  licenseId: string,
): Promise<void> {
  await waitFor(
    () => {
      const licenseIdInput = within(pane).getByLabelText(
        "Driver's license ID number",
      );
      invariant(
        licenseIdInput instanceof HTMLInputElement,
        "Expected driver's license ID input while waiting for sync.",
      );
      expect(licenseIdInput.value).toBe(licenseId);
      expect(pane.textContent?.includes(`Driver's License ${licenseId}`)).toBe(
        true,
      );
    },
    { timeout: 10_000 },
  );
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

test(
  "dual panes can share a container and refresh peer discovery",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await openExplorer(leftPane);
    await openExplorer(rightPane);

    await createChildContainer(leftPane, "Shared");
    await shareContainerWithPeer(leftPane, "Shared");
    await selectPeerSharedContainer(rightPane, "Shared");

    expect(listExplorerContainerItems(rightPane).length).toBeGreaterThan(1);
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual panes can share a container and refresh a post-share note with an image attachment once current-epoch document recipient envelopes are materialized",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

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
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual panes can share the root container after linking an existing root note into a child container",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await openExplorer(leftPane);
    await openExplorer(rightPane);

    await createChildContainer(leftPane, "Child");
    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "/"));
    });

    await createInlineNoteWithAttachment(
      leftPane,
      "Pre-share linked note",
      "pre-share-linked.png",
    );
    const createdDocumentId = await waitForInlineNoteToSettle(
      leftPane,
      "Pre-share linked note",
      "pre-share-linked.png",
    );

    await linkOpenNoteToContainer(leftPane, "Child");

    await waitFor(() => {
      expect(
        within(leftPane).getByRole("button", {
          name: "Open linked container /",
        }),
      ).toBeTruthy();
      expect(
        within(leftPane).getByRole("button", {
          name: "Open linked container Child",
        }),
      ).toBeTruthy();
    });

    await shareContainerWithPeer(leftPane, "/");
    await openPeerNoteAndAssertAttachment(
      rightPane,
      "Child",
      createdDocumentId,
      "Pre-share linked note",
      "pre-share-linked.png",
    );
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer can move a child container under another sibling",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Target");
    await createChildContainer(leftPane, "Moved");

    const targetId = await selectContainerAndReadId(leftPane, "Target");
    await moveContainer(leftPane, "Moved", "Target");
    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Moved"));
    });

    await waitFor(() => {
      expect(within(leftPane).getByText(`Parent: ${targetId}`)).toBeTruthy();
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer can move a note between sibling containers",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Source");
    await createChildContainer(leftPane, "Target");
    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });

    await createInlineNoteWithAttachment(
      leftPane,
      "Movable note",
      "move-note.png",
    );
    await waitForInlineNoteToSettle(leftPane, "Movable note", "move-note.png");

    await waitFor(() => {
      expect(within(leftPane).getByText("note in Source")).toBeTruthy();
    });

    await moveOpenNoteToContainer(leftPane, "Target");

    await waitFor(() => {
      expect(within(leftPane).getByText("note in Target")).toBeTruthy();
    });

    await interact(() => {
      fireEvent.click(
        within(leftPane).getByRole("button", { name: "Back to Container" }),
      );
    });

    await waitFor(() => {
      expect(
        getExplorerSidebarItem(leftPane, "Target").classList.contains(
          "explorer-sidebar-item--selected",
        ),
      ).toBe(true);
    });

    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });
    await waitFor(() => {
      expect(listExplorerNoteItemsInContainer(leftPane, "Source")).toHaveLength(
        0,
      );
    });

    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Target"));
    });
    await waitFor(() => {
      expect(
        listExplorerNoteItemsInContainer(leftPane, "Target").length,
      ).toBeGreaterThan(0);
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer can link a note to another container and detach the active link",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Source");
    await createChildContainer(leftPane, "Target");
    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });

    await createInlineNoteWithAttachment(
      leftPane,
      "Linked note",
      "linked-note.png",
    );
    await waitForInlineNoteToSettle(leftPane, "Linked note", "linked-note.png");

    await waitFor(() => {
      expect(within(leftPane).getByText("note in Source")).toBeTruthy();
    });

    await linkOpenNoteToContainer(leftPane, "Target");

    await waitFor(() => {
      expect(
        within(leftPane).getByRole("button", {
          name: "Open linked container Source",
        }),
      ).toBeTruthy();
      expect(
        within(leftPane).getByRole("button", {
          name: "Open linked container Target",
        }),
      ).toBeTruthy();
    });

    await interact(() => {
      fireEvent.click(
        within(leftPane).getByRole("button", {
          name: "Detach linked container Source",
        }),
      );
    });

    await waitFor(() => {
      expect(within(leftPane).getByText("note in Target")).toBeTruthy();
      expect(
        within(leftPane).queryByRole("button", {
          name: "Open linked container Source",
        }),
      ).toBeNull();
    });

    await interact(() => {
      fireEvent.click(
        within(leftPane).getByRole("button", { name: "Back to Container" }),
      );
    });

    await waitFor(() => {
      expect(
        getExplorerSidebarItem(leftPane, "Target").classList.contains(
          "explorer-sidebar-item--selected",
        ),
      ).toBe(true);
    });

    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });
    await waitFor(() => {
      expect(listExplorerNoteItemsInContainer(leftPane, "Source")).toHaveLength(
        0,
      );
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer can switch the active linked container for a linked note",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Source");
    await createChildContainer(leftPane, "Target");
    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });

    await createInlineNoteWithAttachment(
      leftPane,
      "Activatable note",
      "activatable-note.png",
    );
    await waitForInlineNoteToSettle(
      leftPane,
      "Activatable note",
      "activatable-note.png",
    );

    await waitFor(() => {
      expect(within(leftPane).getByText("note in Source")).toBeTruthy();
    });

    await linkOpenNoteToContainer(leftPane, "Target");

    await waitForCondition(
      () =>
        within(leftPane).queryByRole("button", {
          name: "Make linked container Target active",
        }) !== null,
      "Linked note did not expose Target as an activatable linked container.",
    );

    await activateOpenNoteInLinkedContainer(leftPane, "Target");

    await waitFor(() => {
      expect(within(leftPane).getByText("note in Target")).toBeTruthy();
      expect(
        within(leftPane).queryByRole("button", {
          name: "Make linked container Target active",
        }),
      ).toBeNull();
    });

    await interact(() => {
      fireEvent.click(
        within(leftPane).getByRole("button", { name: "Back to Container" }),
      );
    });

    await waitFor(() => {
      expect(
        getExplorerSidebarItem(leftPane, "Target").classList.contains(
          "explorer-sidebar-item--selected",
        ),
      ).toBe(true);
    });

    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });
    await waitFor(() => {
      expect(listExplorerNoteItemsInContainer(leftPane, "Source")).toHaveLength(
        1,
      );
    });

    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Target"));
    });
    await waitFor(() => {
      expect(
        listExplorerNoteItemsInContainer(leftPane, "Target").length,
      ).toBeGreaterThan(0);
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer can switch the active linked container for a linked driver's license",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Source");
    await createChildContainer(leftPane, "Target");
    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });

    await createInlineDriverLicense(leftPane, "DL-424242", "2031-09-30");
    await waitForInlineDriverLicenseToSettle(leftPane, "DL-424242");

    await waitFor(() => {
      expect(
        within(leftPane).getByText("driver's license in Source"),
      ).toBeTruthy();
    });

    await linkOpenNoteToContainer(leftPane, "Target");

    await waitForCondition(
      () =>
        within(leftPane).queryByRole("button", {
          name: "Make linked container Target active",
        }) !== null,
      "Linked driver's license did not expose Target as an activatable linked container.",
    );

    await activateOpenNoteInLinkedContainer(leftPane, "Target");

    await waitFor(() => {
      expect(
        within(leftPane).getByText("driver's license in Target"),
      ).toBeTruthy();
      expect(
        within(leftPane).queryByRole("button", {
          name: "Make linked container Target active",
        }),
      ).toBeNull();
    });

    await interact(() => {
      fireEvent.click(
        within(leftPane).getByRole("button", { name: "Back to Container" }),
      );
    });

    await waitFor(() => {
      expect(
        getExplorerSidebarItem(leftPane, "Target").classList.contains(
          "explorer-sidebar-item--selected",
        ),
      ).toBe(true);
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer shows linked note projections under each linked container and sidebar selection can switch the active projection",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Source");
    await createChildContainer(leftPane, "Target");
    await interact(() => {
      fireEvent.click(getExplorerSidebarItem(leftPane, "Source"));
    });

    await createInlineNoteWithAttachment(
      leftPane,
      "Projected note",
      "projected-note.png",
    );
    await waitForInlineNoteToSettle(
      leftPane,
      "Projected note",
      "projected-note.png",
    );

    await linkOpenNoteToContainer(leftPane, "Target");

    await waitForCondition(
      () =>
        listExplorerNoteItemsInContainer(leftPane, "Source")
          .map((button) => button.textContent?.trim())
          .includes("Projected note") &&
        listExplorerNoteItemsInContainer(leftPane, "Target")
          .map((button) => button.textContent?.trim())
          .includes("Projected note"),
      "Linked note projections did not appear under both Source and Target.",
    );

    await interact(() => {
      fireEvent.click(
        getExplorerNoteItemInContainer(leftPane, "Target", "Projected note"),
      );
    });

    await waitForCondition(
      () =>
        leftPane.textContent?.includes("note in Target") === true &&
        getExplorerNoteItemInContainer(
          leftPane,
          "Target",
          "Projected note",
        ).classList.contains("explorer-sidebar-item--selected") &&
        !getExplorerNoteItemInContainer(
          leftPane,
          "Source",
          "Projected note",
        ).classList.contains("explorer-sidebar-item--selected"),
      "Selecting the linked Target projection did not activate the note in Target.",
    );
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);
