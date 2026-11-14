import { afterEach, expect, mock, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerNode,
  createDomainScope,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { ExplorerContainerInfoPanel } from "../../../mini-apps/explorer/detail/container/ExplorerContainerInfoPanel";
import { ContainerPrimaryDocumentField } from "./ContainerPrimaryDocumentField";

afterEach(cleanup);

test("General owns the actual dropdown and preserves pending saves and failures across tabs", async () => {
  const node: ContainerNode = {
    id: "container-1",
    kind: "container",
    name: "Documents",
    organizationId: "org-1",
    parentId: null,
    effectiveAccessLevel: "admin",
    primaryDocumentId: "canonical-contact",
    syncState: syncedContainerDocumentObjectSyncState,
  };
  const scope = createDomainScope();
  const pending = Promise.withResolvers<ContainerNode | null>();
  const sharing = Promise.withResolvers<boolean>();
  const setPrimary = mock(() => pending.promise);
  const logError = mock(() => {});
  const documentQueries = {
    loadContainerDocumentSummary: async () => ({
      id: "local-contact",
      documentId: "canonical-contact",
      documentKind: "contact",
      containerId: node.id,
      title: "Ada",
      updatedAt: "now",
    }),
    listContainerDocumentSidebarWindow: async () => ({
      rows: [],
      totalCount: 0,
    }),
  } as unknown as ContainerDocumentQueries;
  const view = render(
    <ExplorerContainerInfoPanel
      canManageIcon={false}
      canShareContainer
      canShareWithPeer
      containerIcon={null}
      containerId={node.id}
      containerName={node.name}
      containerNamesById={new Map([[node.id, node.name]])}
      containerSyncStatus="synced"
      loadContainerInfo={async () => ({
        local: { createdAt: null, updatedAt: null },
        remoteInfo: { grantRows: [], grants: [], groups: [], syncCursors: [] },
      })}
      logError={logError}
      onOpenGrant={() => {}}
      peerUserId="peer-user"
      primaryDocumentSettings={
        <ContainerPrimaryDocumentField
          node={node}
          scope={scope}
          revision={0}
          readOnly={false}
          documentQueries={documentQueries}
          setPrimary={setPrimary}
          logError={logError}
        />
      }
      setContainerIcon={async () => null}
      shareScope={{
        domainScope: scope,
        organizationId: "org-1",
        signingFingerprint: "fingerprint-1",
        userId: "user-1",
      }}
      shareWithGroup={async () => false}
      shareWithUser={() => sharing.promise}
    />,
  );
  await waitFor(() =>
    expect(
      view.getByRole("combobox", { name: "Primary document" }).textContent,
    ).toContain("Ada"),
  );
  const original = view.getByRole("combobox", {
    name: "Primary document",
  }) as HTMLButtonElement;
  for (const name of ["Sharing", "Security", "Sync"]) {
    fireEvent.click(view.getByRole("tab", { name }));
    expect(
      view.queryByRole("combobox", { name: "Primary document" }),
    ).toBeNull();
    expect(original.isConnected).toBe(true);
  }
  fireEvent.click(view.getByRole("tab", { name: "General" }));
  expect(view.getByRole("combobox", { name: "Primary document" })).toBe(
    original,
  );
  fireEvent.click(original);
  fireEvent.click(view.getByRole("option", { name: "None" }));
  expect(setPrimary).toHaveBeenCalledWith(node.id, null);
  expect(original.disabled).toBe(true);
  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));
  expect(view.queryByRole("combobox", { name: "Primary document" })).toBeNull();
  fireEvent.click(view.getByRole("tab", { name: "General" }));
  expect(view.getByRole("combobox", { name: "Primary document" })).toBe(
    original,
  );
  expect(original.disabled).toBe(true);
  fireEvent.click(original);
  expect(setPrimary).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));
  fireEvent.click(view.getByRole("button", { name: "Share With Peer" }));
  await waitFor(() =>
    expect(view.queryByRole("tab", { name: "General" })).toBeNull(),
  );
  await act(async () => pending.reject(new Error("Primary update rejected")));
  expect(view.queryByRole("alert")).toBeNull();
  await act(async () => sharing.resolve(true));
  await waitFor(() =>
    expect(view.queryByRole("tab", { name: "General" })).not.toBeNull(),
  );
  fireEvent.click(view.getByRole("tab", { name: "General" }));
  expect(view.getByRole("alert").textContent).toBe("Primary update rejected");
  expect(view.getByRole("combobox", { name: "Primary document" })).toBe(
    original,
  );
  expect(original.disabled).toBe(false);
  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));
  fireEvent.click(view.getByRole("tab", { name: "General" }));
  expect(view.getByRole("alert").textContent).toBe("Primary update rejected");
  expect(logError).toHaveBeenCalledTimes(1);
});
