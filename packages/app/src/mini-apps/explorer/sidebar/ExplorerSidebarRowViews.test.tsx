import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentSidebarRow,
  ContainerNode,
} from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EXPLORER_ORPHANED_DOCUMENTS_ID } from "../../../stores/explorer/orphanedDocuments";
import { ExplorerSidebarVirtualTree } from "./ExplorerSidebarRowViews";

afterEach(() => cleanup());

function createIconNode(icon: string | undefined): ContainerNode {
  return {
    id: "child-container",
    ...(icon ? { icon } : {}),
    kind: "container",
    name: "Child",
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedState,
  };
}

function renderSidebarIcon(icon: string | undefined) {
  const node = createIconNode(icon);
  return (
    <ExplorerSidebarVirtualTree
      activeContainerId={null}
      contactAvatarUrlByLocalId={{}}
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      depth={0}
      offset={0}
      onContextMenu={() => undefined}
      onDocumentContextMenu={() => undefined}
      onRetryDocumentWindow={() => undefined}
      onSelectContainer={() => undefined}
      onSelectDocument={() => undefined}
      onToggleCollapsed={() => undefined}
      rows={[
        {
          depth: 1,
          entry: { children: [], node },
          isCollapsed: false,
          key: node.id,
          kind: "container",
        },
      ]}
      selectedId={null}
      totalRows={1}
    />
  );
}

test("explorer sidebar row updates when a container icon changes", async () => {
  const view = render(renderSidebarIcon("folder"));
  const childButton = await view.findByRole("button", { name: "Child" });
  expect(
    childButton
      .querySelector(".explorer-folder-icon")
      ?.getAttribute("data-icon"),
  ).toBe("folder");

  view.rerender(renderSidebarIcon("playlist"));

  await waitFor(() => {
    const updatedChildButton = view.getByRole("button", { name: "Child" });
    expect(
      updatedChildButton
        .querySelector(".explorer-folder-icon")
        ?.getAttribute("data-icon"),
    ).toBe("playlist");
  });
});

test("the recovery collection suppresses the native context menu", () => {
  const node: ContainerNode = {
    id: EXPLORER_ORPHANED_DOCUMENTS_ID,
    kind: "container",
    name: "Orphaned Documents",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedState,
  };
  const view = render(
    <ExplorerSidebarVirtualTree
      activeContainerId={node.id}
      contactAvatarUrlByLocalId={{}}
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      depth={0}
      offset={0}
      onContextMenu={() => undefined}
      onDocumentContextMenu={() => undefined}
      onRetryDocumentWindow={() => undefined}
      onSelectContainer={() => undefined}
      onSelectDocument={() => undefined}
      onToggleCollapsed={() => undefined}
      rows={[
        {
          depth: 0,
          entry: { children: [], node },
          isCollapsed: false,
          key: node.id,
          kind: "container",
        },
      ]}
      selectedId={node.id}
      totalRows={1}
    />,
  );

  expect(
    fireEvent.contextMenu(
      view.getByRole("button", { name: "Orphaned Documents" }),
    ),
  ).toBe(false);
});

const CONTACTS_CONTAINER_ID = "contacts-container";
const contactRow: ContainerDocumentSidebarRow = {
  containerId: CONTACTS_CONTAINER_ID,
  documentId: "contact-doc",
  documentKind: "contact",
  localId: "contact-local-id",
  syncState: syncedState,
  title: "Ada Lovelace",
  updatedAt: null,
};

function renderSidebarContact(avatarUrlByLocalId: Record<string, string>) {
  return (
    <ExplorerSidebarVirtualTree
      activeContainerId={null}
      contactAvatarUrlByLocalId={avatarUrlByLocalId}
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      depth={0}
      offset={0}
      onContextMenu={() => undefined}
      onDocumentContextMenu={() => undefined}
      onRetryDocumentWindow={() => undefined}
      onSelectContainer={() => undefined}
      onSelectDocument={() => undefined}
      onToggleCollapsed={() => undefined}
      rows={[
        {
          containerId: CONTACTS_CONTAINER_ID,
          depth: 1,
          documentIndex: 0,
          key: contactRow.localId,
          kind: "document",
          state: {
            error: null,
            isLoading: false,
            offset: 0,
            rows: [contactRow],
            totalCount: 1,
          },
        },
      ]}
      selectedId={null}
      totalRows={1}
    />
  );
}

test("explorer sidebar contact row uses the shared avatar placeholder", async () => {
  const view = render(renderSidebarContact({}));
  const contactButton = await view.findByRole("button", {
    name: "Ada Lovelace",
  });

  expect(contactButton.querySelector(".explorer-document-icon")).toBeNull();
  expect(contactButton.querySelector(".contact-avatar")).not.toBeNull();
  expect(contactButton.querySelector(".contact-avatar-image")).toBeNull();
  expect(
    contactButton.querySelector(".contact-avatar-silhouette"),
  ).not.toBeNull();
});

test("explorer sidebar contact row shows the avatar in place of the glyph", async () => {
  const view = render(
    renderSidebarContact({ [contactRow.localId]: "blob:avatar" }),
  );
  const contactButton = await view.findByRole("button", {
    name: "Ada Lovelace",
  });

  expect(contactButton.querySelector(".explorer-document-icon")).toBeNull();
  expect(
    contactButton.querySelector(".contact-avatar-image")?.getAttribute("src"),
  ).toBe("blob:avatar");
});

test("an orphan sidebar document opens without a context menu", () => {
  const selected: Array<[string, string]> = [];
  let contextMenuCount = 0;
  const orphanRow: ContainerDocumentSidebarRow = {
    ...contactRow,
    containerId: null,
    documentKind: "note",
    localId: "orphan-local",
    title: "Recovered note",
  };
  const view = render(
    <ExplorerSidebarVirtualTree
      activeContainerId={EXPLORER_ORPHANED_DOCUMENTS_ID}
      contactAvatarUrlByLocalId={{}}
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      depth={0}
      offset={0}
      onContextMenu={() => undefined}
      onDocumentContextMenu={() => {
        contextMenuCount += 1;
      }}
      onRetryDocumentWindow={() => undefined}
      onSelectContainer={() => undefined}
      onSelectDocument={(localId, containerId) => {
        selected.push([localId, containerId]);
      }}
      onToggleCollapsed={() => undefined}
      rows={[
        {
          containerId: EXPLORER_ORPHANED_DOCUMENTS_ID,
          depth: 1,
          documentIndex: 0,
          key: orphanRow.localId,
          kind: "document",
          state: {
            error: null,
            isLoading: false,
            offset: 0,
            rows: [orphanRow],
            totalCount: 1,
          },
        },
      ]}
      selectedId={orphanRow.localId}
      totalRows={1}
    />,
  );

  const button = view.getByRole("button", { name: "Recovered note" });
  expect(fireEvent.contextMenu(button)).toBe(false);
  fireEvent.click(button);
  expect(contextMenuCount).toBe(0);
  expect(selected).toEqual([
    [orphanRow.localId, EXPLORER_ORPHANED_DOCUMENTS_ID],
  ]);
});
