import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentSidebarRow,
  ContainerNode,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@tearleads/client-sdk";
import { cleanup, render, waitFor } from "@testing-library/react";
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
      documentWindowsByContainerId={new Map()}
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

const contactRow: ContainerDocumentSidebarRow = {
  containerId: "contacts-container",
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
      documentWindowsByContainerId={new Map()}
      offset={0}
      onContextMenu={() => undefined}
      onDocumentContextMenu={() => undefined}
      onRetryDocumentWindow={() => undefined}
      onSelectContainer={() => undefined}
      onSelectDocument={() => undefined}
      onToggleCollapsed={() => undefined}
      rows={[
        {
          containerId: contactRow.containerId,
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

test("explorer sidebar contact row falls back to the document glyph without an avatar", async () => {
  const view = render(renderSidebarContact({}));
  const contactButton = await view.findByRole("button", {
    name: "Ada Lovelace",
  });

  expect(contactButton.querySelector(".explorer-document-icon")).not.toBeNull();
  expect(contactButton.querySelector(".contact-avatar-image")).toBeNull();
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
