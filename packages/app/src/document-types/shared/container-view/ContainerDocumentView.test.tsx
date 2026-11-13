import { afterEach, expect, spyOn, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerNode,
  createDomainScope,
  type DocumentSummary,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
  effectiveAccessLevel: "read",
};
const scope = createDomainScope();
function props(overrides = {}) {
  return {
    node,
    scope,
    revision: 0,
    readOnly: false,
    logError: () => {},
    onOpenDocument: () => {},
    setPrimary: async () => node,
    documentQueries: {
      loadContainerDocumentSummary: async () => contact,
      listContainerDocumentSidebarWindow: async () => ({
        rows: [],
        totalCount: 0,
      }),
    } as unknown as ContainerDocumentQueries,
    ...overrides,
  };
}

test("missing primary falls back without erasing it and keeps clear/change controls", async () => {
  const writes: unknown[] = [];
  const view = render(
    <ContainerDocumentView
      {...props({
        documentQueries: {
          ...props().documentQueries,
          loadContainerDocumentSummary: async () => null,
          listContainerDocumentSidebarWindow: async () => ({
            totalCount: 1,
            rows: [
              {
                localId: "local-b",
                documentId: "remote-b",
                documentKind: "contact",
                title: "Grace",
              },
            ],
          }),
        },
        setPrimary: async (id: string, value: string | null) => {
          writes.push([id, value]);
          return { ...node, primaryDocumentId: value };
        },
      })}
    >
      <div>Normal listing</div>
    </ContainerDocumentView>,
  );
  await waitFor(() =>
    expect(
      view.queryByText(
        "Primary document is unavailable on this device. Showing contents.",
      ) !== null,
    ).toBe(true),
  );
  expect(view.queryByText("Normal listing") !== null).toBe(true);
  expect(writes).toEqual([]);
  fireEvent.click(
    view.getByRole("button", { name: "Change primary document" }),
  );
  await waitFor(() =>
    expect(
      view.queryByRole("button", { name: "Use Grace as primary" }) !== null,
    ).toBe(true),
  );
  fireEvent.click(view.getByRole("button", { name: "Use Grace as primary" }));
  await waitFor(() => expect(writes).toEqual([["folder", "remote-b"]]));
  fireEvent.click(view.getByRole("button", { name: "Clear primary document" }));
  await waitFor(() =>
    expect(writes).toEqual([
      ["folder", "remote-b"],
      ["folder", null],
    ]),
  );
});

test("contact view shows scoped read-only notes below it in bounded pages", async () => {
  const renderer = spyOn(
    getDocumentTypeDefinition("contact"),
    "ContainerView",
  ).mockImplementation(() => <div>Contact panel</div>);
  const noteRenderer = spyOn(Notes, "NoteDocumentApp").mockImplementation(
    (p) => (
      <div>
        {p.localId}:{p.containerId}:{String(p.readOnly)}
      </div>
    ),
  );
  const requests: unknown[] = [];
  const queries = {
    ...props().documentQueries,
    listContainerDocumentSidebarWindow: async (input: {
      containerId: string;
      offset: number;
      limit: number;
      documentKind?: string;
    }) => {
      requests.push(input);
      return {
        totalCount: 6,
        rows: Array.from(
          { length: Math.min(input.limit, 6 - input.offset) },
          (_, i) => ({
            localId: `note-${input.offset + i}`,
            documentId: `remote-note-${input.offset + i}`,
            documentKind: "note",
            containerId: "folder",
            title: `Note ${input.offset + i}`,
            updatedAt: null,
            syncState: syncedContainerDocumentObjectSyncState,
          }),
        ),
      };
    },
  };
  try {
    const view = render(
      <ContainerDocumentView {...props({ documentQueries: queries })}>
        <div>Normal listing</div>
      </ContainerDocumentView>,
    );
    await waitFor(() =>
      expect(view.queryByText("note-0:folder:true") !== null).toBe(true),
    );
    expect(view.container.textContent?.indexOf("Contact panel")).toBeLessThan(
      view.container.textContent?.indexOf("note-0") ?? 0,
    );
    expect(view.queryByText("note-5:folder:true")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Next notes" }));
    await waitFor(() =>
      expect(view.queryByText("note-5:folder:true") !== null).toBe(true),
    );
    expect(view.queryByText("note-0:folder:true")).toBeNull();
    expect(requests).toEqual([
      { containerId: "folder", documentKind: "note", offset: 0, limit: 5 },
      { containerId: "folder", documentKind: "note", offset: 5, limit: 5 },
    ]);
  } finally {
    renderer.mockRestore();
    noteRenderer.mockRestore();
  }
});

test("registered primary renders with its exact identity and can return to Contents", async () => {
  const definition = getDocumentTypeDefinition("contact");
  const renderer = spyOn(definition, "ContainerView").mockImplementation(
    (p) => (
      <div>
        Contact {p.localId} in {p.containerId}
      </div>
    ),
  );
  try {
    const view = render(
      <ContainerDocumentView {...props()}>
        <div>Normal listing</div>
      </ContainerDocumentView>,
    );
    await waitFor(() =>
      expect(view.queryByText("Contact local-contact in folder") !== null).toBe(
        true,
      ),
    );
    expect(view.queryByText("Normal listing")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Contents" }));
    expect(view.queryByText("Normal listing") !== null).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Contact view" }));
    expect(view.queryByText("Contact local-contact in folder") !== null).toBe(
      true,
    );
  } finally {
    renderer.mockRestore();
  }
});
