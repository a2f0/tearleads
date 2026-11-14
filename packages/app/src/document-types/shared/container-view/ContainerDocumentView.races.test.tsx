import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerNode,
  createDomainScope,
  type DocumentSummary,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as Notes from "../../note/NoteDocumentApp";
import { getDocumentTypeDefinition } from "../../registry";
import { ContainerDocumentView } from "./ContainerDocumentView";

afterEach(cleanup);
const node: ContainerNode = {
  id: "folder",
  kind: "container",
  name: "Person",
  parentId: null,
  organizationId: "org",
  effectiveAccessLevel: "admin",
  syncState: syncedContainerDocumentObjectSyncState,
  primaryDocumentId: "remote-contact",
};
const contact: DocumentSummary = {
  id: "local-contact",
  documentId: "remote-contact",
  documentKind: "contact",
  containerId: "folder",
  title: "Ada",
  updatedAt: "now",
};
function setup() {
  return {
    node,
    scope: createDomainScope(),
    revision: 0,
    readOnly: false,
    onOpenDocument: () => {},
    documentQueries: {
      loadContainerDocumentSummary: async () => contact,
      listContainerDocumentSidebarWindow: async () => ({
        rows: [],
        totalCount: 0,
      }),
    } as unknown as ContainerDocumentQueries,
  };
}
function contents() {
  return <div>Normal listing</div>;
}

test("late notes do not cross container or account boundaries", async () => {
  const renderer = spyOn(
    getDocumentTypeDefinition("contact"),
    "ContainerView",
  ).mockImplementation(() => <div>Contact</div>);
  const noteRenderer = spyOn(Notes, "NoteDocumentApp").mockImplementation(
    (p) => <div>{p.localId}</div>,
  );
  try {
    const p = setup();
    const pending =
      Promise.withResolvers<
        Awaited<
          ReturnType<
            ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
          >
        >
      >();
    const loadNotes = mock(() => pending.promise);
    p.documentQueries.listContainerDocumentSidebarWindow = loadNotes;
    const view = render(
      <ContainerDocumentView {...p}>{contents()}</ContainerDocumentView>,
    );
    await waitFor(() => expect(loadNotes).toHaveBeenCalledTimes(1));
    const next = setup();
    next.node = { ...node, id: "other" };
    view.rerender(
      <ContainerDocumentView {...next}>{contents()}</ContainerDocumentView>,
    );
    await waitFor(() =>
      expect(view.queryByText("No notes in this container.")).not.toBeNull(),
    );
    await act(async () => {
      pending.resolve({
        totalCount: 1,
        rows: [
          {
            containerId: "folder",
            localId: "old-note",
            documentId: "remote-note",
            documentKind: "note",
            title: "Old note",
            updatedAt: null,
            syncState: syncedContainerDocumentObjectSyncState,
          },
        ],
      });
    });
    expect(view.queryByText("old-note")).toBeNull();
    expect(noteRenderer).not.toHaveBeenCalled();
  } finally {
    renderer.mockRestore();
    noteRenderer.mockRestore();
  }
});

test.each(["no-primary", "unknown", "unavailable", "failed"])(
  "%s primary keeps the listing without management controls",
  async (reason) => {
    const p = setup();
    p.node = {
      ...node,
      ...(reason === "no-primary" ? { primaryDocumentId: null } : {}),
    };
    p.documentQueries.loadContainerDocumentSummary = async () => {
      if (reason === "failed") throw new Error("Query failed");
      return reason === "unavailable"
        ? null
        : { ...contact, documentKind: "future-kind" };
    };
    const view = render(
      <ContainerDocumentView {...p}>{contents()}</ContainerDocumentView>,
    );
    await act(async () => {});
    expect(view.getByText("Normal listing")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Contact view" })).toBeNull();
    expect(
      view.queryByRole("combobox", { name: "Primary document" }),
    ).toBeNull();
  },
);

test.each(["container", "account"])(
  "late lookups cannot display stale primary after %s navigation",
  async (reason) => {
    const renderer = spyOn(
      getDocumentTypeDefinition("contact"),
      "ContainerView",
    ).mockImplementation((p) => <div>{p.localId}</div>);
    try {
      const p = setup();
      const old = Promise.withResolvers<DocumentSummary | null>();
      p.documentQueries.loadContainerDocumentSummary = () => old.promise;
      const view = render(
        <ContainerDocumentView {...p}>{contents()}</ContainerDocumentView>,
      );
      const next = setup();
      if (reason === "container") next.node = { ...node, id: "other" };
      next.documentQueries.loadContainerDocumentSummary = async () => ({
        ...contact,
        id: "new-local",
      });
      view.rerender(
        <ContainerDocumentView {...next}>{contents()}</ContainerDocumentView>,
      );
      await waitFor(() => expect(view.queryByText("new-local")).not.toBeNull());
      await act(async () => {
        old.resolve(contact);
      });
      expect(view.queryByText("local-contact")).toBeNull();
      expect(view.getByText("new-local")).toBeTruthy();
    } finally {
      renderer.mockRestore();
    }
  },
);
