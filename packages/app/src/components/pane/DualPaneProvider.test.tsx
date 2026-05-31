import { afterEach, expect, test } from "bun:test";
import { createModuleSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
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
import {
  AppTestRuntimeScopeProbe,
  waitForAppTestRuntimeToSettle,
} from "../../../test/helpers/appRuntimeIdle";
import { MockWorker } from "../../../test/helpers/mockWorker";
import {
  getProxiedApiNetworkActivitySnapshot,
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
  wsUrl,
} from "../../../test/helpers/mswServer";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { AppHostConfig } from "../../host/AppHostConfig";
import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { ORG_MANAGER_LABELS } from "../../mini-apps/org-manager/labels";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { DualPaneProvider, PaneSideProvider } from "./DualPaneProvider";
import { Pane } from "./Pane";
import { PaneProvider } from "./PaneProvider";

const DUAL_PANE_TEST_TIMEOUT_MS = 20_000;
const DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS = 30_000;
const POST_SHARE_SYNC_SETTLE_TIMEOUT_MS = 6_000;
const POST_SHARE_NETWORK_IDLE_QUIET_MS = 25;
const POST_SHARE_NETWORK_IDLE_TIMEOUT_MS = 500;
const POST_SHARE_NETWORK_IDLE_INTERVAL_MS = 10;
const MAX_REQUEST_SUMMARY_BODY_LENGTH = 500;
const SHARED_NOTE_TITLE = "Peer one note with attachment";
const MOVED_NOTE_TITLE = "Moved folder note";
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

interface ProxiedApiRequestBudget {
  byRequest?: Readonly<Record<string, number>>;
  total: number;
}

const OWNER_GRANTED_ROOT_ATTACHMENT_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  total: 140,
  byRequest: {
    "GET /documents/:documentId/writer-projection": 30,
    "POST /documents/:documentId/sync": 30,
    "GET /containers/:containerId/documents": 30,
    "GET /containers": 24,
    "GET /auth/encapsulation-key/:userId": 12,
    "GET /containers/:containerId/writer-projection": 12,
    "GET /organizations/:organizationId/groups": 9,
  },
};

const requestProfileEnv = process.env as {
  DUAL_PANE_REQUEST_PROFILE?: string;
  DUAL_PANE_REQUEST_PROFILE_DETAIL?: string;
};

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
    createModuleSQLiteRuntime({ workerConstructor: MockWorker }),
  );

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          <PaneAutoProvisioner />
          <Pane className="pane pane-left" />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          <PaneAutoProvisioner />
          <Pane className="pane pane-right" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

function renderSinglePane({
  autoProvision = true,
}: {
  autoProvision?: boolean;
} = {}) {
  const hostConfig = new AppHostConfig("http://localhost:3001", wsUrl, () =>
    createModuleSQLiteRuntime({ workerConstructor: MockWorker }),
  );

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          {autoProvision && <PaneAutoProvisioner />}
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

function queryExplorerItemTable(root: HTMLElement): HTMLElement | null {
  return within(root).queryByRole("table", { name: /^Items in /u });
}

async function openExplorer(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  const openExplorerButton = screen.getByRole("button", {
    name: "Open Explorer",
  });
  await interact(() => {
    fireEvent.click(openExplorerButton);
  });

  await waitFor(() => {
    expect(queryExplorerItemTable(pane)).toBeTruthy();
  });
}

async function openExplorerNewStructuredDocumentRoute(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(within(pane).getByRole("menuitem", { name: "File" }));
  });
  const newStructuredDocumentItem = within(pane).getByRole("menuitem", {
    name: "New Structured Document",
  });
  await interact(() => {
    fireEvent.click(newStructuredDocumentItem);
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
  const createChildButton = screen.getByRole("button", {
    name: "Create Child",
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
  await openExplorerNewStructuredDocumentRoute(pane);
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
    expect(queryExplorerItemTable(pane)).toBeTruthy();
  });
}

async function createNoteInContainer(
  pane: HTMLElement,
  containerName: string,
  title: string,
) {
  await selectContainerAndWaitForItemTable(pane, containerName);
  await openExplorerNewStructuredDocumentRoute(pane);
  const newNoteButton = await within(pane).findByRole("button", {
    name: "New Note",
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

async function shareContainerWithPeer(pane: HTMLElement, name: string) {
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
  const getInfoButton = screen.getByRole("button", {
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
  await waitForCondition(
    () =>
      Array.from(pane.querySelectorAll("tr")).some((row) => {
        const text = row.textContent ?? "";
        return text.includes(groupName) && text.includes(accessLevel);
      }),
    `Container group share did not appear in grants.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
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
}

async function addPeerToAdminsGroup(pane: HTMLElement, peerUserId: string) {
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

  await waitFor(() => {
    expect(userIdInput.value).toBe("");
  });
}

async function createOrganizationGroup(pane: HTMLElement, groupName: string) {
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

async function openExplorerContainerInfo(pane: HTMLElement, name: string) {
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

async function findExplorerInfoGrantRow(
  pane: HTMLElement,
  groupName: string,
  accessLevel: string,
): Promise<HTMLTableRowElement> {
  let row: HTMLTableRowElement | null = null;
  await waitFor(() => {
    const explorerWindow = getExplorerWindowRoot(pane);
    row =
      Array.from(
        explorerWindow.querySelectorAll<HTMLTableRowElement>("tr"),
      ).find((candidate) => {
        const text = candidate.textContent ?? "";
        return text.includes(groupName) && text.includes(accessLevel);
      }) ?? null;
    expect(row).toBeTruthy();
  });

  invariant(row, `Expected grant row for "${groupName}".`);
  return row;
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function requestPathAndQuery(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return url;
  }
}

function normalizeRequestPath(path: string): string {
  return path
    .replace(
      /^\/auth\/encapsulation-key\/[^/]+$/u,
      "/auth/encapsulation-key/:userId",
    )
    .replace(
      /^\/organizations\/[^/]+\/groups$/u,
      "/organizations/:organizationId/groups",
    )
    .replace(
      /^\/principals\/group\/[^/]+\/policy$/u,
      "/principals/group/:groupId/policy",
    )
    .replace(
      /^\/containers\/[^/]+\/documents$/u,
      "/containers/:containerId/documents",
    )
    .replace(
      /^\/containers\/[^/]+\/writer-projection$/u,
      "/containers/:containerId/writer-projection",
    )
    .replace(/^\/containers\/[^/]+\/share$/u, "/containers/:containerId/share")
    .replace(/^\/containers\/[^/]+\/move$/u, "/containers/:containerId/move")
    .replace(
      /^\/documents\/[^/]+\/writer-projection$/u,
      "/documents/:documentId/writer-projection",
    )
    .replace(/^\/documents\/[^/]+\/sync$/u, "/documents/:documentId/sync")
    .replace(
      /^\/documents\/[^/]+\/attachments$/u,
      "/documents/:documentId/attachments",
    )
    .replace(
      /^\/blobs\/[^/]+\/attachment-bindings$/u,
      "/blobs/:blobId/attachment-bindings",
    )
    .replace(/^\/blobs\/[^/]+\/bytes$/u, "/blobs/:blobId/bytes");
}

function shortRequestPathIds(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      segment.length >= 16 && /^[0-9a-f-]+$/iu.test(segment)
        ? segment.slice(0, 8)
        : segment,
    )
    .join("/");
}

function proxiedApiRequestVolumeKey(request: ProxiedApiRequest): string {
  return `${request.method} ${normalizeRequestPath(requestPath(request.url))}`;
}

function countProxiedApiRequestVolume(
  requests: readonly ProxiedApiRequest[],
): Map<string, { count: number; statuses: Map<number, number> }> {
  const countsByRequest = new Map<
    string,
    { count: number; statuses: Map<number, number> }
  >();

  for (const request of requests) {
    const key = proxiedApiRequestVolumeKey(request);
    const entry = countsByRequest.get(key) ?? { count: 0, statuses: new Map() };
    entry.count += 1;
    entry.statuses.set(
      request.status,
      (entry.statuses.get(request.status) ?? 0) + 1,
    );
    countsByRequest.set(key, entry);
  }

  return countsByRequest;
}

function summarizeProxiedApiRequestVolume(
  requests: readonly ProxiedApiRequest[],
): string {
  return [...countProxiedApiRequestVolume(requests).entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([key, entry]) => {
      const statuses = [...entry.statuses.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([status, count]) => `${status}:${count}`)
        .join(",");
      return `${entry.count.toString().padStart(3, " ")} ${key} statuses=${statuses}`;
    })
    .join("\n");
}

function summarizeRepeatedProxiedApiRequestPaths(
  requests: readonly ProxiedApiRequest[],
): string {
  const countsByPath = new Map<string, number>();
  for (const request of requests) {
    const key = `${request.method} ${shortRequestPathIds(requestPathAndQuery(request.url))}`;
    countsByPath.set(key, (countsByPath.get(key) ?? 0) + 1);
  }

  const repeatedPaths = [...countsByPath.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (repeatedPaths.length === 0) {
    return "(no repeated exact paths)";
  }

  return repeatedPaths
    .map(([key, count]) => `${count.toString().padStart(3, " ")} ${key}`)
    .join("\n");
}

function profileProxiedApiRequests(
  label: string,
  requestStartIndex: number,
  requestEndIndex = listProxiedApiRequests().length,
) {
  if (requestProfileEnv.DUAL_PANE_REQUEST_PROFILE !== "1") {
    return;
  }

  const requests = listProxiedApiRequests().slice(
    requestStartIndex,
    requestEndIndex,
  );
  console.info(
    `[dual-pane-request-profile] ${label} total=${requests.length}\n${summarizeProxiedApiRequestVolume(requests)}`,
  );
  if (requestProfileEnv.DUAL_PANE_REQUEST_PROFILE_DETAIL === "1") {
    console.info(
      `[dual-pane-request-profile-detail] ${label} repeated-paths\n${summarizeRepeatedProxiedApiRequestPaths(requests)}`,
    );
  }
}

function expectProxiedApiRequestBudget(
  label: string,
  requests: readonly ProxiedApiRequest[],
  budget: ProxiedApiRequestBudget,
) {
  const requestVolumeSummary = summarizeProxiedApiRequestVolume(requests);
  const repeatedPathSummary = summarizeRepeatedProxiedApiRequestPaths(requests);
  const failureSummary = `request volume=\n${requestVolumeSummary}\nrepeated paths=\n${repeatedPathSummary}`;

  expect(
    requests.length,
    `${label} exceeded proxied API request budget ${budget.total}.\n${failureSummary}`,
  ).toBeLessThanOrEqual(budget.total);

  const countsByRequest = countProxiedApiRequestVolume(requests);
  for (const [requestKey, requestBudget] of Object.entries(
    budget.byRequest ?? {},
  )) {
    const actualCount = countsByRequest.get(requestKey)?.count ?? 0;
    expect(
      actualCount,
      `${label} exceeded proxied API request budget for ${requestKey}: ${actualCount} > ${requestBudget}.\n${failureSummary}`,
    ).toBeLessThanOrEqual(requestBudget);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProxiedApiNetworkQuiet(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastCompletedRequestCount =
    getProxiedApiNetworkActivitySnapshot().completedRequestCount;
  let quietStartedAt = Date.now();

  while (Date.now() <= deadline) {
    const activity = getProxiedApiNetworkActivitySnapshot();
    if (
      activity.activeRequestCount === 0 &&
      activity.completedRequestCount === lastCompletedRequestCount
    ) {
      if (Date.now() - quietStartedAt >= POST_SHARE_NETWORK_IDLE_QUIET_MS) {
        return true;
      }
    } else {
      lastCompletedRequestCount = activity.completedRequestCount;
      quietStartedAt = Date.now();
    }

    await delay(POST_SHARE_NETWORK_IDLE_INTERVAL_MS);
  }

  return false;
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

function isDocumentWriterProjectionStaleContentBundleFailure(
  request: ProxiedApiRequest,
): boolean {
  return (
    request.method === "GET" &&
    request.status === 409 &&
    /^\/documents\/[^/]+\/writer-projection$/u.test(requestPath(request.url)) &&
    request.responseBody.includes("Document content-key bundle is stale")
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
  while (Date.now() - startedAt < POST_SHARE_SYNC_SETTLE_TIMEOUT_MS) {
    const remainingTimeoutMs = Math.max(
      0,
      POST_SHARE_SYNC_SETTLE_TIMEOUT_MS - (Date.now() - startedAt),
    );

    let runtimeSettled = false;
    await act(async () => {
      runtimeSettled = await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: remainingTimeoutMs,
      });
    });

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

    if (unresolvedFailures.length === 0) {
      return;
    }
    if (!runtimeSettled) {
      break;
    }
  }

  expect(
    unresolvedFailures,
    `Unresolved post-share sync failures.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(requestStartIndex))}`,
  ).toEqual([]);
}

async function waitForNoImmediatePostShareFailures(
  panes: readonly HTMLElement[],
  requestStartIndex: number,
) {
  await act(async () => {
    await waitForProxiedApiNetworkQuiet(POST_SHARE_NETWORK_IDLE_TIMEOUT_MS);
  });

  const postShareRequests = listProxiedApiRequests().slice(requestStartIndex);
  const unresolvedFailures = listUnresolvedPostShareFailures(postShareRequests);
  const paneErrors = listPaneErrorLines(panes);

  expect(
    unresolvedFailures,
    `Unexpected post-share API failures.\nrequests=\n${summarizeProxiedApiRequests(postShareRequests)}`,
  ).toEqual([]);
  expect(
    paneErrors,
    `Unexpected post-share pane errors.\nrequests=\n${summarizeProxiedApiRequests(postShareRequests)}`,
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

async function provisionPaneFromMenu(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const generateButton = screen.getByRole("button", {
    name: "Generate Key Pair",
  });
  await interact(() => {
    fireEvent.click(generateButton);
  });

  await waitFor(() => {
    expect(within(pane).getByText(/sqlite worker: ready/)).toBeTruthy();
  });

  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const uploadButton = screen.getByRole("button", {
    name: "Upload Public Key",
  });
  await interact(() => {
    fireEvent.click(uploadButton);
  });

  await waitForSinglePaneProvisioning(pane);
}

async function downloadPaneKeyPackageBackup(
  pane: HTMLElement,
): Promise<string> {
  const downloaded = { blob: null as Blob | null };
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  try {
    URL.createObjectURL = ((blob: Blob) => {
      downloaded.blob = blob;
      return "blob:tearleads-key-package-test";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = () => undefined;

    await interact(() => {
      fireEvent.click(within(pane).getByText("Menu"));
    });
    const backupButton = screen.getByRole("button", {
      name: "Backup Key Package",
    });
    await interact(() => {
      fireEvent.click(backupButton);
    });

    const blob = downloaded.blob;
    if (!blob) {
      throw new Error("Expected key package backup blob.");
    }
    return blob.text();
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
}

async function destroyPaneKeyPackage(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const destroyButton = screen.getByRole("button", {
    name: "Destroy Key Pair",
  });
  await interact(() => {
    fireEvent.click(destroyButton);
  });

  await waitForCondition(
    () =>
      (pane.textContent?.includes("userId: none") ?? false) &&
      (pane.textContent?.includes("sqlite worker: idle") ?? false),
    "Pane did not clear local identity state after key destruction.",
  );
}

async function restorePaneKeyPackageBackup(
  pane: HTMLElement,
  backupJson: string,
) {
  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const fileInput = screen.getByLabelText("Restore Key Package File");
  const restoreButton = screen.getByRole("button", {
    name: "Restore Key Package",
  });
  await interact(() => {
    fireEvent.click(restoreButton);
  });

  const backupFile = new File([backupJson], "tearleads-key-package.json", {
    type: "application/json",
  });
  await interact(() => {
    fireEvent.change(fileInput, {
      target: { files: [backupFile] },
    });
  });

  await waitForSinglePaneProvisioning(pane);
  await waitFor(() => {
    expect(within(pane).getByText(/sqlite worker: ready/)).toBeTruthy();
  });
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
  await waitForCondition(() => {
    if (predicate()) {
      return true;
    }

    clickAvailableExplorerRefresh(pane);
    return false;
  }, message);
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
  "pane menu backs up and restores a registered key package",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane({ autoProvision: false });
    const pane = getPaneRoot(view, "left");

    await provisionPaneFromMenu(pane);
    const backupJson = await downloadPaneKeyPackageBackup(pane);

    await destroyPaneKeyPackage(pane);

    const restoreRequestStartIndex = listProxiedApiRequests().length;
    await restorePaneKeyPackageBackup(pane, backupJson);
    await waitForCondition(
      () =>
        listProxiedApiRequests()
          .slice(restoreRequestStartIndex)
          .some(
            (request) =>
              request.method === "POST" &&
              request.status === 200 &&
              requestPath(request.url) === "/auth/verify",
          ),
      `Restored key package did not authenticate.\nrequests=\n${summarizeProxiedApiRequests()}`,
    );

    expect(listPaneErrorLines([pane])).toEqual([]);
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

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

    await createChildContainer(leftPane, "Shared");
    await shareContainerWithPeer(leftPane, "Shared");

    const duplicateShareRequestStartIndex = listProxiedApiRequests().length;
    await clickShareWithPeer(leftPane);
    await waitForNoImmediatePostShareFailures(
      [leftPane],
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
  "explorer grant rows open the org manager group route",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");
    const groupName = "Grant Inspectors";

    await waitForSinglePaneProvisioning(leftPane);

    await createOrganizationGroup(leftPane, groupName);
    const directoryButton = within(leftPane).getByRole("button", {
      name: ORG_MANAGER_LABELS.directory,
    });
    await interact(() => {
      fireEvent.click(directoryButton);
    });
    await waitFor(() => {
      expect(within(leftPane).queryByLabelText("User ID")).toBeNull();
    });

    await openExplorer(leftPane);
    await shareContainerWithGroup(leftPane, "/", groupName, "read");
    await openExplorerContainerInfo(leftPane, "/");
    const grantRow = await findExplorerInfoGrantRow(
      leftPane,
      groupName,
      "read",
    );

    await interact(() => {
      fireEvent.click(grantRow);
    });

    await waitFor(() => {
      expect(within(leftPane).getByLabelText("User ID")).toBeTruthy();
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "dual panes can share an owner-granted root container after an empty folder and note attachment",
  async () => {
    useTestApiAppHandlers();
    const testRequestStartIndex = listProxiedApiRequests().length;
    let requestPhaseStartIndex = testRequestStartIndex;
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    profileProxiedApiRequests("provisioning", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

    await openExplorer(leftPane);
    profileProxiedApiRequests("open left explorer", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

    await openExplorer(rightPane);
    profileProxiedApiRequests("open right explorer", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

    await createChildContainer(leftPane, "Empty");
    profileProxiedApiRequests("create empty folder", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

    await createNoteWithAttachment(leftPane);
    profileProxiedApiRequests(
      "create note with attachment",
      requestPhaseStartIndex,
    );
    requestPhaseStartIndex = listProxiedApiRequests().length;

    const postShareRequestStartIndex = listProxiedApiRequests().length;
    await shareContainerWithPeer(leftPane, "/");
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareRequestStartIndex,
    );
    profileProxiedApiRequests(
      "share root + post-share settle",
      requestPhaseStartIndex,
    );
    requestPhaseStartIndex = listProxiedApiRequests().length;

    const postRefreshRequestStartIndex = listProxiedApiRequests().length;
    await clickExplorerRefresh(rightPane);
    await waitForSharedNoteVisible(rightPane);
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postRefreshRequestStartIndex,
    );
    profileProxiedApiRequests(
      "right refresh + shared note settle",
      requestPhaseStartIndex,
    );

    const shareRequest = listProxiedApiRequests()
      .filter(
        (request) =>
          request.method === "POST" && request.url.endsWith("/share"),
      )
      .at(-1);
    expect(shareRequest?.status).toBe(200);
    profileProxiedApiRequests("test total", testRequestStartIndex);
    expectProxiedApiRequestBudget(
      "owner-granted root attachment share",
      listProxiedApiRequests().slice(testRequestStartIndex),
      OWNER_GRANTED_ROOT_ATTACHMENT_REQUEST_BUDGET,
    );
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

test(
  "moving a logged-in container with a note keeps document writer projection current",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Target");
    await createChildContainer(leftPane, "Moved");
    await createNoteInContainer(leftPane, "Moved", MOVED_NOTE_TITLE);

    const requestStartIndex = listProxiedApiRequests().length;
    await moveContainer(leftPane, "Moved", "Target");
    await waitForNoPostShareSyncFailures([leftPane], requestStartIndex);

    const staleWriterProjectionRequests = listProxiedApiRequests()
      .slice(requestStartIndex)
      .filter(isDocumentWriterProjectionStaleContentBundleFailure);

    expect(
      staleWriterProjectionRequests,
      `Container move should not leave document content-key bundles stale.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(requestStartIndex))}`,
    ).toEqual([]);
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);
