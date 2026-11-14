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
import { useState } from "react";
import { getDocumentTypeDefinition } from "../../registry";
import { ContainerDocumentView } from "./ContainerDocumentView";

afterEach(cleanup);
const contact: DocumentSummary = {
  id: "local-contact",
  documentId: "remote-contact",
  documentKind: "contact",
  containerId: "folder",
  title: "Ada",
  updatedAt: "now",
};
const node: ContainerNode = {
  id: "folder",
  kind: "container",
  name: "Person",
  parentId: null,
  organizationId: "org",
  effectiveAccessLevel: "admin",
  syncState: syncedContainerDocumentObjectSyncState,
  primaryDocumentId: contact.documentId,
};
function EditablePrimary() {
  const [value, setValue] = useState("saved");
  return (
    <input
      aria-label="Primary draft"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
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

test("same-primary refresh preserves draft and focus, but an unavailable result removes it", async () => {
  const renderer = spyOn(
    getDocumentTypeDefinition("contact"),
    "ContainerView",
  ).mockImplementation(EditablePrimary);
  try {
    const p = setup();
    const pending = Promise.withResolvers<DocumentSummary | null>();
    const load = mock(async () => contact as DocumentSummary | null);
    p.documentQueries.loadContainerDocumentSummary = load;
    const view = render(
      <ContainerDocumentView {...p}>Contents</ContainerDocumentView>,
    );
    await waitFor(() =>
      expect(view.queryByRole("textbox") !== null).toBe(true),
    );
    const input = view.getByRole("textbox") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "unsaved" } });
    load.mockImplementation(() => pending.promise);
    view.rerender(
      <ContainerDocumentView {...p} revision={1}>
        Contents
      </ContainerDocumentView>,
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(view.queryByRole("textbox") === input).toBe(true);
    expect(input.value).toBe("unsaved");
    expect(document.activeElement === input).toBe(true);
    await act(async () => pending.resolve({ ...contact, title: "Refreshed" }));
    expect(view.queryByRole("textbox") === input).toBe(true);
    expect(input.value).toBe("unsaved");
    load.mockImplementation(async () => null);
    view.rerender(
      <ContainerDocumentView {...p} revision={2}>
        Contents
      </ContainerDocumentView>,
    );
    await waitFor(() =>
      expect(view.queryByRole("textbox") === null).toBe(true),
    );
    expect(view.getByText("Contents")).toBeTruthy();
  } finally {
    renderer.mockRestore();
  }
});

test.each(["primary", "account", "container", "access", "failed"])(
  "%s change does not retain a loaded primary",
  async (reason) => {
    const renderer = spyOn(
      getDocumentTypeDefinition("contact"),
      "ContainerView",
    ).mockImplementation(EditablePrimary);
    try {
      const p = setup();
      const pending = Promise.withResolvers<DocumentSummary | null>();
      const load = mock(async () => contact as DocumentSummary | null);
      p.documentQueries.loadContainerDocumentSummary = load;
      const view = render(
        <ContainerDocumentView {...p}>Contents</ContainerDocumentView>,
      );
      await waitFor(() =>
        expect(view.queryByRole("textbox") !== null).toBe(true),
      );
      load.mockImplementation(() => pending.promise);
      const next = { ...p, revision: 1 };
      if (reason === "primary")
        next.node = { ...node, primaryDocumentId: "other" };
      if (reason === "account") next.scope = createDomainScope();
      if (reason === "container") next.node = { ...node, id: "other" };
      if (reason === "access")
        next.node = { ...node, effectiveAccessLevel: "read" };
      view.rerender(
        <ContainerDocumentView {...next}>Contents</ContainerDocumentView>,
      );
      if (reason !== "failed")
        expect(view.queryByRole("textbox") === null).toBe(true);
      await act(async () => pending.reject(new Error("Lookup refused")));
      expect(view.queryByRole("textbox") === null).toBe(true);
      expect(view.getByText("Lookup refused")).toBeTruthy();
    } finally {
      renderer.mockRestore();
    }
  },
);
