import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerNode,
  createDomainScope,
  type DocumentSummary,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
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
    logError: mock(() => {}),
    onOpenDocument: () => {},
    setPrimary: mock(
      async (
        _id: string,
        _documentId: string | null,
      ): Promise<ContainerNode | null> => node,
    ),
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
  "%s primary keeps the listing and never erases preference",
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
    expect(p.setPrimary).not.toHaveBeenCalled();
  },
);

test.each(["read", "trash", "recovery"])(
  "%s mode hides primary mutations",
  async (reason) => {
    const p = setup();
    p.readOnly = reason === "trash";
    p.node = {
      ...node,
      primaryDocumentId: null,
      effectiveAccessLevel: reason === "read" ? "read" : "admin",
      metadataReady: reason !== "recovery",
    };
    const view = render(
      <ContainerDocumentView {...p}>{contents()}</ContainerDocumentView>,
    );
    await act(async () => {});
    expect(
      view.queryByRole("button", { name: "Set primary document" }),
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

test("Contents toggle does not hide a failed save and rapid clicks only submit once", async () => {
  const renderer = spyOn(
    getDocumentTypeDefinition("contact"),
    "ContainerView",
  ).mockImplementation(() => <div>Contact</div>);
  try {
    const p = setup();
    const pending = Promise.withResolvers<ContainerNode | null>();
    p.setPrimary = mock(() => pending.promise);
    const view = render(
      <ContainerDocumentView {...p}>{contents()}</ContainerDocumentView>,
    );
    await waitFor(() =>
      expect(view.queryByRole("button", { name: "Contents" })).not.toBeNull(),
    );
    const clear = view.getByRole("button", { name: "Clear primary document" });
    fireEvent.click(clear);
    fireEvent.click(clear);
    fireEvent.click(view.getByRole("button", { name: "Contents" }));
    expect(p.setPrimary).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error("Save rejected"));
    });
    expect(view.getByRole("alert").textContent).toBe("Save rejected");
    expect(view.getByText("Normal listing")).toBeTruthy();
    expect(p.logError).toHaveBeenCalledTimes(1);
  } finally {
    renderer.mockRestore();
  }
});

test("late save failure is logged but cannot contaminate a newly selected container", async () => {
  const p = setup();
  p.node = { ...node, primaryDocumentId: null };
  const pending = Promise.withResolvers<ContainerNode | null>();
  p.setPrimary = mock(() => pending.promise);
  p.documentQueries.listContainerDocumentSidebarWindow = async () => ({
    rows: [
      {
        containerId: "folder",
        localId: contact.id,
        documentId: contact.documentId,
        documentKind: "contact",
        title: "Ada",
        updatedAt: null,
        syncState: syncedContainerDocumentObjectSyncState,
      },
    ],
    totalCount: 1,
  });
  const view = render(
    <ContainerDocumentView {...p}>{contents()}</ContainerDocumentView>,
  );
  fireEvent.click(view.getByRole("button", { name: "Set primary document" }));
  await waitFor(() =>
    expect(
      view.queryByRole("button", { name: "Use Ada as primary" }),
    ).not.toBeNull(),
  );
  fireEvent.click(view.getByRole("button", { name: "Use Ada as primary" }));
  view.rerender(
    <ContainerDocumentView {...p} node={{ ...p.node, id: "other" }}>
      {contents()}
    </ContainerDocumentView>,
  );
  await act(async () => {
    pending.reject(new Error("Old failure"));
  });
  expect(p.logError).toHaveBeenCalledTimes(1);
  expect(view.queryByRole("alert")).toBeNull();
  expect(p.setPrimary).toHaveBeenCalledWith("folder", "remote-contact");
});
