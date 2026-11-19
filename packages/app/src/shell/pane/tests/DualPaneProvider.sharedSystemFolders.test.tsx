import { afterEach, expect, test } from "bun:test";
import type { ContainerContentsStore } from "@tearleads/client-sdk";
import { deriveOrganizationTrashSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ContainerTreeProbe } from "../../../../test/helpers/dual-pane/ContainerTreeProbe";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItem,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  renderSinglePane,
  selectContainerAndWaitForItemTable,
  waitForDualPaneProvisioning,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  createNoteInContainer,
  openExplorer,
  refreshUntil,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  addPeerToAdminsGroup,
  createGroupAndAddPeer,
  shareContainerWithGroup,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import type { PaneSide } from "../dual-pane";

const OWNER_SHARED_FOLDER = "Owner Shared Folder";

function countSystemContainerRemoteCreates(startIndex: number): number {
  return listProxiedApiRequests()
    .slice(startIndex)
    .filter(
      (request) =>
        request.method === "POST" &&
        request.status === 200 &&
        request.url.includes("/containers/with-metadata-document"),
    ).length;
}

// How many system containers registration carried in its provisioning request
// body — the count of eagerly-provisioned system containers (the Trash bin)
// born with the organization in the same transaction.
function countRegistrationSystemContainers(startIndex: number): number {
  const registration = listProxiedApiRequests()
    .slice(startIndex)
    .find(
      (request) =>
        request.method === "POST" &&
        request.status === 200 &&
        request.url.includes("/auth/register"),
    );
  if (!registration?.requestBody) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(registration.requestBody);
    const systemContainers =
      parsed && typeof parsed === "object"
        ? Reflect.get(parsed, "initialSystemContainers")
        : null;
    return Array.isArray(systemContainers) ? systemContainers.length : 0;
  } catch {
    return 0;
  }
}

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

// Regression for bug A: the built-in system containers must reach the server so
// a peer granted the root can see them (server container listing is hierarchical,
// returning every *remote* child of an authorized root). The two folders reach
// the server by different routes now: Trash is born with the organization —
// provisioned server-side in the same transaction as the org, so it rides in the
// registration request body — while Contacts stays device-first (created
// LOCAL-ONLY at bootstrap) and is promoted to remote sync once authenticated.
// This asserts both routes: registration carries the eager Trash, and Contacts
// is promoted via /containers/with-metadata-document. It is single-pane on
// purpose: it verifies the routes + confirms they do not destabilize normal
// operation, without the churn of two panes syncing at once.
test(
  "authenticated bootstrap provisions Trash with the org and promotes Contacts",
  async () => {
    useTestApiAppHandlers();
    const startIndex = listProxiedApiRequests().length;
    const view = renderSinglePane();
    const pane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(pane);
    await openExplorer(pane);

    await refreshUntil(
      pane,
      () => getExplorerSidebarItemsByName(pane, "Contacts").length > 0,
      "Owner did not provision the Contacts system folder.",
    );
    await refreshUntil(
      pane,
      () => getExplorerSidebarItemsByName(pane, "Trash").length > 0,
      "Owner did not provision the Trash system folder.",
    );

    // Trash was provisioned eagerly: it rode in the registration request body,
    // so it never took the device-first create-then-promote path.
    expect(
      countRegistrationSystemContainers(startIndex),
    ).toBeGreaterThanOrEqual(1);

    // Contacts is still device-first: it gets created remotely via
    // /containers/with-metadata-document once promotion runs post-auth. (Its
    // metadata document also syncs, but the container create is the load-bearing
    // signal that it left local-only.)
    await waitForCondition(
      () => countSystemContainerRemoteCreates(startIndex) >= 1,
      "Contacts was not promoted to remote sync.",
      20_000,
    );
    expect(
      countSystemContainerRemoteCreates(startIndex),
    ).toBeGreaterThanOrEqual(1);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

async function openItemMenu(target: HTMLElement) {
  await interact(() => fireEvent.contextMenu(target.closest("tr") ?? target));
  const menu = document.querySelector<HTMLElement>(".menu");
  if (!menu) throw new Error("Missing Explorer context menu");
  return within(menu);
}

test.each(["admin", "write"] as const)(
  "a peer with %s access can trash shared items from their own active organization",
  async (accessLevel) => {
    useTestApiAppHandlers();
    const trees = new Map<PaneSide, ContainerContentsStore>();
    const view = renderDualPane({
      children: <ContainerTreeProbe trees={trees} />,
    });
    const founder = getPaneRoot(view, "left");
    const peer = getPaneRoot(view, "right");
    await waitForDualPaneProvisioning(founder, peer);
    const ownerTree = trees.get("left");
    await waitForCondition(
      () =>
        !!ownerTree
          ?.getSnapshot()
          .nodes.some(
            (node) => !node.parentId && !node.systemSlot && node.organizationId,
          ),
      "Founder root did not hydrate.",
    );
    const root = ownerTree
      ?.getSnapshot()
      .nodes.find(
        (node) => !node.parentId && !node.systemSlot && node.organizationId,
      );
    if (!ownerTree || !root) throw new Error("Missing founder root");
    const slot = deriveOrganizationTrashSystemSlot(root.organizationId);
    await act(async () => {
      await ownerTree.createChild(root.id, OWNER_SHARED_FOLDER);
    });
    const folder = ownerTree
      .getSnapshot()
      .nodes.find((node) => node.name === OWNER_SHARED_FOLDER);
    if (!folder) throw new Error("Shared folder was not created");
    const title = "Shared note to delete";
    const writers = "Trash writers";
    if (accessLevel === "write") {
      await createGroupAndAddPeer(founder, writers, getPaneUserId(peer));
    }
    await openExplorer(founder);
    await createNoteInContainer(founder, OWNER_SHARED_FOLDER, title);
    await openExplorer(peer);
    if (accessLevel === "admin") {
      await addPeerToAdminsGroup(founder, getPaneUserId(peer));
    } else {
      await shareContainerWithGroup(
        founder,
        OWNER_SHARED_FOLDER,
        writers,
        "write",
      );
      await shareContainerWithGroup(founder, "Trash", writers, "write");
      await clickExplorerRefresh(peer);
    }
    await waitForCondition(
      async () => {
        await act(async () => {});
        const nodes = trees.get("right")?.getSnapshot().nodes ?? [];
        return (
          nodes.some(
            (node) => node.systemSlot === slot && node.parentId === root.id,
          ) &&
          nodes.some(
            (node) =>
              node.id === folder.id &&
              node.name === OWNER_SHARED_FOLDER &&
              node.effectiveAccessLevel === accessLevel,
          )
        );
      },
      "The peer did not hydrate the shared folder and Trash at the granted access level.",
      30_000,
    );
    if (accessLevel === "write") {
      expect(
        trees
          .get("right")
          ?.getSnapshot()
          .nodes.some((node) => node.id === root.id),
      ).toBe(false);
    }
    const table = await selectContainerAndWaitForItemTable(
      peer,
      OWNER_SHARED_FOLDER,
    );
    const note = await within(table).findByRole(
      "button",
      { name: title },
      { timeout: 20_000 },
    );
    const before = listProxiedApiRequests().length;
    const noteMenu = await openItemMenu(note);
    const moveNote = await noteMenu.findByRole(
      "button",
      { name: "Move to Trash" },
      { timeout: 10_000 },
    );
    expect(moveNote.hasAttribute("disabled")).toBe(false);
    await interact(() => fireEvent.click(moveNote));
    await waitForCondition(
      () =>
        listProxiedApiRequests()
          .slice(before)
          .some(({ url, status }) => url.endsWith("/unlink") && status === 200),
      "The peer did not commit the document move.",
      30_000,
    );
    const trashTable = await selectContainerAndWaitForItemTable(
      founder,
      "Trash",
    );
    expect(
      await within(trashTable).findByRole(
        "button",
        { name: title },
        { timeout: 20_000 },
      ),
    ).toBeTruthy();
    const folderMenu = await openItemMenu(
      getExplorerSidebarItem(peer, OWNER_SHARED_FOLDER),
    );
    if (accessLevel === "write") {
      expect(folderMenu.getByRole("button", { name: "Get Info" })).toBeTruthy();
      expect(
        folderMenu.queryByRole("button", { name: "Move to Trash" }),
      ).toBeNull();
      return;
    }
    const moveFolder = folderMenu.getByRole("button", {
      name: "Move to Trash",
    });
    await interact(() => fireEvent.click(moveFolder));
    await waitForCondition(
      async () => {
        await act(async () => {});
        const nodes = ownerTree.getSnapshot().nodes;
        const trash = nodes.find(
          (node) => node.parentId === root.id && node.systemSlot === slot,
        );
        return (
          !!trash &&
          nodes.find((node) => node.id === folder.id)?.parentId === trash.id
        );
      },
      "The founder did not observe the shared folder in Trash.",
      30_000,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
