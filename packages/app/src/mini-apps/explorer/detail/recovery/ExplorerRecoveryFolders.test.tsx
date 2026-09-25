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
