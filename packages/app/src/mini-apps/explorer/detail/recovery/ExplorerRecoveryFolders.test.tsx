import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ExplorerRecoveryFolders } from "./ExplorerRecoveryFolders";

afterEach(cleanup);
const retained = {
  containerId: "retained",
  organizationId: "org",
  name: "Queued rename",
  icon: null,
  pendingUpdateCount: 1,
  hasStructuralIntent: true,
  revision: "revision-1",
};
const local: ContainerNode = {
  id: "local",
  organizationId: "org",
  name: "Local child",
  parentId: "missing-parent",
  metadataDocumentId: null,
  kind: "container",
  syncState: {
    pendingUpdateCount: 0,
    pendingAttachmentCount: 0,
    pendingAttachmentBytes: 0,
    lastError: null,
    status: "local-only" as const,
  },
};

function fixture(discarded: Array<typeof retained>, result = true) {
  const selected: Array<string | null> = [];
  const menus: string[] = [];
  const documentQueries = {
    listRecoveryFolderMoveIds: async () => [],
    listRecoveryFolders: async () => [retained],
    discardRecoveryFolder: async (input: typeof retained) => {
      discarded.push(input);
      return result;
    },
  } as unknown as ContainerDocumentQueries;
  const view = render(
    <ExplorerRecoveryFolders
      containerNodes={[local]}
      currentOrganizationId="org"
      documentQueries={documentQueries}
      onRecoveryChanged={() => {}}
      documentListRevision={0}
      setSelectedId={(id) => selected.push(id)}
      onContainerContextMenu={(_, id) => menus.push(id)}
    />,
  );
  return { ...view, selected, menus };
}

test("recovery exposes orphan local folders and requires confirmation before discarding retained edits", async () => {
  const discarded: Array<typeof retained> = [];
  const view = fixture(discarded);
  await view.findByText("Queued rename");
  fireEvent.click(view.getByRole("button", { name: "Local child" }));
  expect(view.selected).toEqual(["local"]);
  fireEvent.click(
    view.getByRole("button", { name: "Actions for Local child" }),
  );
  expect(view.menus).toEqual(["local"]);
  fireEvent.click(view.getByRole("button", { name: "Discard local copy" }));
  expect(discarded).toEqual([]);
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(discarded).toEqual([]);
  fireEvent.click(view.getByRole("button", { name: "Discard local copy" }));
  const dialog = view.getByRole("dialog");
  const submit = dialog.querySelector('button[type="submit"]');
  if (!submit) throw new Error("Missing confirmation submit");
  fireEvent.click(submit);
  await waitFor(() => expect(discarded).toEqual([retained]));
  await waitFor(() => expect(view.queryByText("Queued rename")).toBeNull());
});

test("a stale confirmation keeps the retained folder visible", async () => {
  const discarded: Array<typeof retained> = [];
  const view = fixture(discarded, false);
  await view.findByText("Queued rename");
  fireEvent.click(view.getByRole("button", { name: "Discard local copy" }));
  const submit = view
    .getByRole("dialog")
    .querySelector('button[type="submit"]');
  if (!submit) throw new Error("Missing confirmation submit");
  fireEvent.click(submit);
  await view.findByText(
    "This folder changed. Review the updated copy before discarding it.",
  );
  expect(view.getByText("Queued rename")).toBeTruthy();
});

test("sync snapshots keep the dialog open and a stale refusal reloads its revision", async () => {
  let calls = 0;
  let revision = "revision-1";
  const attempted: string[] = [];
  let changed = 0;
  const documentQueries = {
    listRecoveryFolderMoveIds: async () => [],
    listRecoveryFolders: async () => {
      calls += 1;
      return [{ ...retained, revision }];
    },
    discardRecoveryFolder: async (input: typeof retained) => {
      attempted.push(input.revision);
      revision = "revision-2";
      return input.revision === revision;
    },
  } as unknown as ContainerDocumentQueries;
  const props = {
    currentOrganizationId: "org",
    documentQueries,
    documentListRevision: 0,
    onRecoveryChanged: () => {
      changed += 1;
    },
    setSelectedId: () => {},
    onContainerContextMenu: () => {},
  };
  const view = render(
    <ExplorerRecoveryFolders {...props} containerNodes={[local]} />,
  );
  await view.findByText("Queued rename");
  fireEvent.click(view.getByRole("button", { name: "Discard local copy" }));
  view.rerender(
    <ExplorerRecoveryFolders {...props} containerNodes={[{ ...local }]} />,
  );
  expect(view.getByRole("dialog")).toBeTruthy();
  expect(calls).toBe(1);
  const submit = () => {
    const button = view
      .getByRole("dialog")
      .querySelector('button[type="submit"]');
    if (!button) throw new Error("Missing confirmation submit");
    fireEvent.click(button);
  };
  submit();
  await waitFor(() => expect(calls).toBe(2));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  fireEvent.click(view.getByRole("button", { name: "Discard local copy" }));
  submit();
  await waitFor(() => expect(changed).toBe(1));
  expect(attempted).toEqual(["revision-1", "revision-2"]);
});

test("recovery shows a queued move without listing an ordinary shared folder", async () => {
  const shared = {
    ...local,
    id: "shared",
    name: "Shared folder",
    metadataDocumentId: "metadata-shared",
    syncState: { ...local.syncState, status: "synced" as const },
  };
  const moving = { ...shared, id: "moving", name: "Queued move" };
  const view = render(
    <ExplorerRecoveryFolders
      containerNodes={[shared, moving]}
      currentOrganizationId="org"
      documentQueries={
        {
          listRecoveryFolders: async () => [],
          listRecoveryFolderMoveIds: async () => [moving.id],
        } as unknown as ContainerDocumentQueries
      }
      documentListRevision={0}
      onRecoveryChanged={() => {}}
      onContainerContextMenu={() => {}}
      setSelectedId={() => {}}
    />,
  );
  await view.findByText("Queued move");
  expect(view.queryByText("Shared folder")).toBeNull();
  expect(view.getByText("Pending folder move")).toBeTruthy();
});
