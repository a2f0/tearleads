import { afterEach, expect, test } from "bun:test";
import { createModuleDatabaseRuntime } from "@tearleads/sqlite-worker/runtime";
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
import { AppHostConfig } from "../../host/AppHostConfig";
import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { DualPaneProvider, PaneSideProvider } from "./DualPaneProvider";
import { Pane } from "./Pane";
import { PaneProvider } from "./PaneProvider";

const DUAL_PANE_TEST_TIMEOUT_MS = 20_000;
const DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS = 20_000;
const POST_SHARE_SYNC_SETTLE_MS = 1_500;
const MAX_REQUEST_SUMMARY_BODY_LENGTH = 500;
const SHARED_NOTE_TITLE = "Peer one note with attachment";
const RETRYABLE_DOCUMENT_SYNC_CONFLICT_MESSAGES = [
  "Document KEK targets are stale",
  "Document content-key bundle is stale",
  "Document write authorization manifest does not match sync request",
] as const;

type ProxiedApiRequest = ReturnType<typeof listProxiedApiRequests>[number];

interface BlobAttachmentBindingJson {
  bindingId?: unknown;
  blobId?: unknown;
}

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
  const { generateKey, signingKeyPair } = useIdentity();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
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
      !canRegisterCurrentIdentity ||
      registrationInFlight.current
    ) {
      return;
    }

    registrationInFlight.current = true;
    void registerCurrentIdentity().finally(() => {
      registrationInFlight.current = false;
    });
  }, [
    canRegisterCurrentIdentity,
    containerId,
    registerCurrentIdentity,
    status,
    userId,
  ]);

  return null;
}

function renderDualPane() {
  const hostConfig = new AppHostConfig("http://localhost:3001", wsUrl, () =>
    createModuleDatabaseRuntime({ workerConstructor: MockWorker }),
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
    createModuleDatabaseRuntime({ workerConstructor: MockWorker }),
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

async function openOrgManager(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  const openOrgManagerButton = await screen.findByRole("button", {
    name: "Open Org Manager",
  });
  await interact(() => {
    fireEvent.click(openOrgManagerButton);
  });

  await waitFor(() => {
    expect(within(pane).getByRole("button", { name: "Groups" })).toBeTruthy();
  });
}

function getPaneUserId(pane: HTMLElement): string {
  const match = pane.textContent?.match(
    /userId:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u,
  );
  invariant(match?.[1] && match[1] !== "none", "Expected pane user id.");
  return match[1];
}

function getExplorerSidebarItem(
  pane: HTMLElement,
  name: string,
): HTMLButtonElement {
  const item = getExplorerSidebarItemsByName(pane, name)[0];

  invariant(item, `Expected explorer sidebar item "${name}".`);
  return item;
}

function getExplorerSidebarItemsByName(
  pane: HTMLElement,
  name: string,
): HTMLButtonElement[] {
  return Array.from(
    pane.querySelectorAll<HTMLButtonElement>("button.explorer-sidebar-item"),
  ).filter((button) => button.textContent?.trim() === name);
}

function listExplorerContainerItems(pane: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    pane.querySelectorAll<HTMLButtonElement>("button.explorer-sidebar-item"),
  ).filter(
    (button) => !button.classList.contains("explorer-sidebar-item--note"),
  );
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
  const containerNameInput = await screen.findByLabelText("Container name");
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

async function createNoteWithAttachment(pane: HTMLElement) {
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
  const newNoteButton = await within(pane).findByRole("button", {
    name: "New Note",
  });
  await interact(() => {
    fireEvent.click(newNoteButton);
  });

  const editor = await within(pane).findByRole("textbox", {
    name: /Notes editor/u,
  });
  await waitFor(() => {
    const attachButton = within(pane).getByRole("button", {
      name: "Attach File",
    });
    invariant(
      attachButton instanceof HTMLButtonElement,
      "Expected attach button.",
    );
    expect(attachButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.change(editor, {
      target: { value: SHARED_NOTE_TITLE },
    });
  });

  const fileInput = pane.querySelector<HTMLInputElement>(
    "input.notes-file-input",
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
    expect(within(pane).getByRole("button", { name: "New Note" })).toBeTruthy();
  });
}

async function shareContainerWithPeer(pane: HTMLElement, name: string) {
  const requestStartIndex = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, name), {
      clientX: 200,
      clientY: 200,
    });
  });
  const getInfoButton = await screen.findByRole("button", {
    name: "Get Info",
  });
  await interact(() => {
    fireEvent.click(getInfoButton);
  });
  const shareWithPeerButton = await screen.findByRole("button", {
    name: "Share With Peer",
  });
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

async function clickShareWithPeer(pane: HTMLElement) {
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

async function shareContainerWithGroup(
  pane: HTMLElement,
  name: string,
  groupName: string,
  accessLevel: "read" | "write" | "admin",
) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, name), {
      clientX: 200,
      clientY: 200,
    });
  });
  const getInfoButton = await screen.findByRole("button", {
    name: "Get Info",
  });
  await interact(() => {
    fireEvent.click(getInfoButton);
  });

  const groupSelect = await within(pane).findByLabelText("Group");
  invariant(groupSelect instanceof HTMLSelectElement, "Expected group select.");
  const permissionSelect = within(pane).getByLabelText("Permission");
  invariant(
    permissionSelect instanceof HTMLSelectElement,
    "Expected permission select.",
  );
  let groupOption: HTMLOptionElement | undefined;
  await waitFor(() => {
    groupOption = Array.from(groupSelect.options).find(
      (option) => option.textContent?.trim() === groupName,
    );
    expect(groupOption).toBeTruthy();
  });
  const selectedGroupOption = groupOption;
  invariant(selectedGroupOption, `Expected group option "${groupName}".`);

  await interact(() => {
    fireEvent.change(groupSelect, {
      target: { value: selectedGroupOption.value },
    });
    fireEvent.change(permissionSelect, {
      target: { value: accessLevel },
    });
  });

  const shareButton = within(pane).getByRole("button", { name: "Share" });
  await interact(() => {
    fireEvent.click(shareButton);
  });
  await waitFor(() => {
    expect(
      Array.from(pane.querySelectorAll("tr")).some((row) => {
        const text = row.textContent ?? "";
        return text.includes(groupName) && text.includes(accessLevel);
      }),
    ).toBe(true);
  });

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
    () => Boolean(within(pane).queryByRole("button", { name: "New Note" })),
    `Container group share route did not return to the container.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );
}

async function addPeerToAdminsGroup(pane: HTMLElement, peerUserId: string) {
  await openOrgManager(pane);

  const groupsButton = within(pane).getByRole("button", { name: "Groups" });
  await interact(() => {
    fireEvent.click(groupsButton);
  });

  const adminsButton = await within(pane).findByRole("button", {
    name: /Admins/u,
  });
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

  await waitFor(() => {
    expect(userIdInput.value).toBe("");
  });
}

async function createGroupAndAddPeer(
  pane: HTMLElement,
  groupName: string,
  peerUserId: string,
) {
  await openOrgManager(pane);

  const groupsButton = within(pane).getByRole("button", { name: "Groups" });
  await interact(() => {
    fireEvent.click(groupsButton);
  });

  const groupNameInput = await within(pane).findByPlaceholderText("Group name");
  invariant(
    groupNameInput instanceof HTMLInputElement,
    "Expected group name input.",
  );
  const createButton = within(pane).getByRole("button", { name: "Create" });
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

  const groupButton = await within(pane).findByRole("button", {
    name: new RegExp(groupName, "u"),
  });
  await interact(() => {
    fireEvent.click(groupButton);
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

  await waitFor(() => {
    expect(userIdInput.value).toBe("");
  });
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function parseBlobAttachmentBindingJson(
  body: string,
): BlobAttachmentBindingJson | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as BlobAttachmentBindingJson)
      : null;
  } catch {
    return null;
  }
}

function isSuccessfulBlobAttachmentBinding(
  request: ProxiedApiRequest,
): boolean {
  if (
    request.method !== "POST" ||
    request.status !== 200 ||
    !/^\/blobs\/[^/]+\/attachment-bindings$/u.test(requestPath(request.url))
  ) {
    return false;
  }

  const response = parseBlobAttachmentBindingJson(request.responseBody);
  return (
    typeof response?.blobId === "string" &&
    typeof response.bindingId === "string"
  );
}

async function waitForRemoteAttachmentBlob() {
  await waitForCondition(
    () => listProxiedApiRequests().some(isSuccessfulBlobAttachmentBinding),
    `Note attachment blob was not uploaded before sharing.\nrequests=\n${summarizeProxiedApiRequests()}`,
  );
}

function summarizeRequestBody(body: string | null): string {
  return body === null ? "null" : `<${body.length} chars>`;
}

function truncateText(text: string): string {
  return text.length <= MAX_REQUEST_SUMMARY_BODY_LENGTH
    ? text
    : `${text.slice(0, MAX_REQUEST_SUMMARY_BODY_LENGTH)}... <${text.length} chars>`;
}

function summarizeProxiedApiRequests(
  requests: readonly ProxiedApiRequest[] = listProxiedApiRequests(),
): string {
  return requests
    .map(
      (request) =>
        `${request.method} ${request.status} ${requestPath(request.url)} request=${summarizeRequestBody(request.requestBody)} response=${truncateText(request.responseBody)}`,
    )
    .join("\n");
}

function isRetryableDocumentSyncStaleFailure(
  request: ProxiedApiRequest,
): boolean {
  const responseBody = request.responseBody;
  return (
    request.method === "POST" &&
    request.status === 409 &&
    /^\/documents\/[^/]+\/sync$/u.test(requestPath(request.url)) &&
    (RETRYABLE_DOCUMENT_SYNC_CONFLICT_MESSAGES.some((message) =>
      responseBody.includes(message),
    ) ||
      (responseBody.includes("authorizingContainerPaths") &&
        responseBody.includes("is stale")) ||
      (responseBody.includes("targetContainerPath") &&
        responseBody.includes("is stale")))
  );
}

function hasLaterSuccessfulRetry(
  requests: readonly ProxiedApiRequest[],
  failedRequestIndex: number,
): boolean {
  const failedRequest = requests[failedRequestIndex];
  if (!failedRequest) {
    return false;
  }

  return requests
    .slice(failedRequestIndex + 1)
    .some(
      (request) =>
        request.method === failedRequest.method &&
        request.url === failedRequest.url &&
        request.status >= 200 &&
        request.status < 400,
    );
}

function listUnresolvedPostShareFailures(
  requests: readonly ProxiedApiRequest[],
): ProxiedApiRequest[] {
  return requests.filter((request, index) => {
    if (request.status < 400) {
      return false;
    }
    if (
      isRetryableDocumentSyncStaleFailure(request) &&
      hasLaterSuccessfulRetry(requests, index)
    ) {
      return false;
    }

    return true;
  });
}

function listPaneErrorLines(panes: readonly HTMLElement[]): string[] {
  return panes.flatMap((pane) => {
    const text = pane.textContent ?? "";
    return text
      .split(/(?=\[\d{1,2}:\d{2}:\d{2})/u)
      .filter((line) => line.includes("ERROR:"))
      .map(truncateText);
  });
}

async function waitForNoPostShareSyncFailures(
  panes: readonly HTMLElement[],
  requestStartIndex: number,
) {
  const startedAt = Date.now();
  let unresolvedFailures: readonly ProxiedApiRequest[] = [];
  while (Date.now() - startedAt < POST_SHARE_SYNC_SETTLE_MS) {
    const postShareRequests = listProxiedApiRequests().slice(requestStartIndex);
    const paneErrors = listPaneErrorLines(panes);
    unresolvedFailures = listUnresolvedPostShareFailures(postShareRequests);

    expect(
      unresolvedFailures.filter(
        (request) => !isRetryableDocumentSyncStaleFailure(request),
      ),
      `Unexpected post-share API failures.\nrequests=\n${summarizeProxiedApiRequests(postShareRequests)}`,
    ).toEqual([]);
    expect(
      paneErrors,
      `Unexpected post-share pane errors.\nrequests=\n${summarizeProxiedApiRequests(postShareRequests)}`,
    ).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  expect(
    unresolvedFailures,
    `Unresolved post-share sync failures.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(requestStartIndex))}`,
  ).toEqual([]);
}

function getExplorerWindowRoot(pane: HTMLElement): HTMLElement {
  const explorerTitle = within(pane).getByText("Explorer");
  const explorerWindow = explorerTitle.closest<HTMLElement>(".window");
  invariant(explorerWindow, "Expected Explorer window.");
  return explorerWindow;
}

function openExplorerViewMenu(pane: HTMLElement): HTMLElement {
  const explorerWindow = getExplorerWindowRoot(pane);
  const viewMenuButton = within(explorerWindow).getByRole("menuitem", {
    name: "View",
  });

  if (viewMenuButton.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(viewMenuButton);
  }

  return explorerWindow;
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

async function clickExplorerRefresh(pane: HTMLElement) {
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

async function waitForSharedNoteVisible(pane: HTMLElement) {
  await waitForCondition(
    () => getExplorerSidebarItemsByName(pane, SHARED_NOTE_TITLE).length > 0,
    `Peer did not discover shared note "${SHARED_NOTE_TITLE}".\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );
}

async function selectContainerAndWaitForItemTable(
  pane: HTMLElement,
  name: string,
): Promise<HTMLElement> {
  await interact(() => {
    fireEvent.click(getExplorerSidebarItem(pane, name));
  });

  let table: HTMLElement | null = null;
  await waitFor(() => {
    table = within(pane).getByRole("table", {
      name: `Items in ${name}`,
    });
    expect(table).toBeTruthy();
  });

  invariant(table, `Expected explorer item table for "${name}".`);
  return table;
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
  await waitFor(() => {
    expect(document.activeElement).toBe(destinationSelect);
  });
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

async function refreshUntil(
  pane: HTMLElement,
  predicate: () => boolean,
  message: string,
) {
  await waitFor(() => {
    if (predicate()) {
      return;
    }

    clickAvailableExplorerRefresh(pane);

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
  "dual pane explorer treats a duplicate peer share as a no-op",
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

    const duplicateShareRequestStartIndex = listProxiedApiRequests().length;
    await clickShareWithPeer(leftPane);
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      duplicateShareRequestStartIndex,
    );

    const duplicateShareRequests = listProxiedApiRequests()
      .slice(duplicateShareRequestStartIndex)
      .filter(
        (request) =>
          request.method === "POST" && request.url.endsWith("/share"),
      );
    expect(
      duplicateShareRequests,
      `Duplicate peer share should not create another share mutation.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(duplicateShareRequestStartIndex))}`,
    ).toEqual([]);
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer opens after org manager imports peer into Admins",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    const postAdminAddRequestStartIndex = listProxiedApiRequests().length;
    await openExplorer(leftPane);

    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddRequestStartIndex,
    );

    await openExplorer(rightPane);
    await refreshUntil(
      rightPane,
      () => listExplorerContainerItems(rightPane).length > 1,
      "Peer did not discover the Admins-granted root container.",
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "peer explorer opens directly after org manager imports peer into Admins",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    const postAdminAddRequestStartIndex = listProxiedApiRequests().length;

    await openExplorer(rightPane);
    await refreshUntil(
      rightPane,
      () => listExplorerContainerItems(rightPane).length > 1,
      "Peer did not discover the Admins-granted root container.",
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddRequestStartIndex,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer discovers a root container shared to a newly created group",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");
    const groupName = "Pane 2 Readers";

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await createGroupAndAddPeer(leftPane, groupName, getPaneUserId(rightPane));
    await openExplorer(rightPane);
    await openExplorer(leftPane);
    const postShareRequestStartIndex = listProxiedApiRequests().length;
    await shareContainerWithGroup(leftPane, "/", groupName, "read");

    await clickExplorerRefresh(rightPane);
    await refreshUntil(
      rightPane,
      () => {
        const containerNames = listExplorerContainerItems(rightPane).map(
          (button) => button.textContent?.trim() ?? "",
        );
        return (
          containerNames.length > 1 && !containerNames.includes("Untitled")
        );
      },
      "Peer did not hydrate the root container shared to the new group.",
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareRequestStartIndex,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "dual panes can share an owner-granted root container after an empty folder and note attachment",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await openExplorer(leftPane);
    await openExplorer(rightPane);

    await createChildContainer(leftPane, "Empty");
    await createNoteWithAttachment(leftPane);
    const postShareRequestStartIndex = listProxiedApiRequests().length;
    await shareContainerWithPeer(leftPane, "/");
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareRequestStartIndex,
    );
    const postRefreshRequestStartIndex = listProxiedApiRequests().length;
    await clickExplorerRefresh(rightPane);
    await waitForSharedNoteVisible(rightPane);
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postRefreshRequestStartIndex,
    );

    const shareRequest = listProxiedApiRequests()
      .filter(
        (request) =>
          request.method === "POST" && request.url.endsWith("/share"),
      )
      .at(-1);
    expect(shareRequest?.status).toBe(200);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
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

    await selectContainerAndWaitForItemTable(leftPane, "Target");
    await moveContainer(leftPane, "Moved", "Target");
    const targetTable = await selectContainerAndWaitForItemTable(
      leftPane,
      "Target",
    );

    await waitFor(() => {
      expect(
        within(targetTable).getByRole("button", { name: "Moved" }),
      ).toBeTruthy();
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);
