import { afterEach, expect, mock, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerDocumentSidebarRow,
  type ContainerNode,
  createDomainScope,
  type DocumentSummary,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import { ContainerPrimaryDocumentField } from "./ContainerPrimaryDocumentField";

afterEach(cleanup);
const node: ContainerNode = {
  id: "folder",
  kind: "container",
  name: "Person",
  parentId: null,
  organizationId: "org",
  effectiveAccessLevel: "admin",
  syncState: syncedContainerDocumentObjectSyncState,
  primaryDocumentId: "remote-current",
};
const current: DocumentSummary = {
  id: "local-current",
  documentId: "remote-current",
  documentKind: "contact",
  containerId: "folder",
  title: "Current contact",
  updatedAt: "now",
};
function candidate(index: number): ContainerDocumentSidebarRow {
  return {
    localId: `local-${index}`,
    documentId: `remote-${index}`,
    documentKind: "contact",
    containerId: "folder",
    title: `Contact ${index}`,
    updatedAt: null,
    syncState: syncedContainerDocumentObjectSyncState,
  };
}
function setup() {
  return {
    node,
    scope: createDomainScope(),
    revision: 0,
    readOnly: false,
    logError: mock(() => {}),
    setPrimary: mock(async (_id: string, documentId: string | null) => ({
      ...node,
      primaryDocumentId: documentId,
    })),
    documentQueries: {
      loadContainerDocumentSummary: mock(async () => current),
      listContainerDocumentSidebarWindow: mock(async () => ({
        rows: [candidate(0)],
        totalCount: 1,
      })),
    } as unknown as ContainerDocumentQueries,
  };
}
function openOptions(view: RenderResult) {
  fireEvent.click(view.getByRole("combobox", { name: "Primary document" }));
}

test("selecting a synced document saves its canonical ID and None clears it", async () => {
  const p = setup();
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await waitFor(() =>
    expect(
      view.getByRole("combobox", { name: "Primary document" }).textContent,
    ).toContain("Current contact"),
  );
  openOptions(view);
  fireEvent.click(await view.findByRole("option", { name: "Contact 0" }));
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenCalledWith("folder", "remote-0"),
  );
  await waitFor(() =>
    expect((view.getByRole("combobox") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  openOptions(view);
  fireEvent.click(view.getByRole("option", { name: "None" }));
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenLastCalledWith("folder", null),
  );
  expect(p.setPrimary).toHaveBeenCalledTimes(2);
  expect(
    view.queryByRole("button", {
      name: /(?:Set|Change|Clear) primary document/,
    }),
  ).toBeNull();
});

test("an unavailable current target stays selected until explicitly cleared", async () => {
  const p = setup();
  p.documentQueries.loadContainerDocumentSummary = async () => null;
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  const trigger = await view.findByRole("combobox", {
    name: "Primary document",
  });
  await act(async () => {});
  expect(trigger.textContent).not.toBe("None");
  expect(p.setPrimary).not.toHaveBeenCalled();
  openOptions(view);
  const selected = view
    .getAllByRole("option")
    .filter((option) => option.getAttribute("aria-selected") === "true");
  expect(selected).toHaveLength(1);
  expect(selected[0]?.textContent).not.toBe("None");
  fireEvent.click(view.getByRole("option", { name: "None" }));
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenCalledWith("folder", null),
  );
});

test("20-row pages preserve a current selection outside both pages", async () => {
  const p = setup();
  const list = mock(async (input: { offset: number; limit: number }) => ({
    rows: Array.from(
      { length: Math.min(input.limit, 23 - input.offset) },
      (_, index) => candidate(input.offset + index),
    ),
    totalCount: 23,
  }));
  const summary = mock(async () => current);
  p.documentQueries.listContainerDocumentSidebarWindow = list;
  p.documentQueries.loadContainerDocumentSummary = summary;
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  expect(list.mock.calls[0]?.[0]).toMatchObject({
    containerId: "folder",
    offset: 0,
    limit: 20,
  });
  await waitFor(() =>
    expect(view.getByRole("combobox").textContent).toContain(current.title),
  );
  expect(summary).toHaveBeenCalledWith({
    containerId: "folder",
    documentId: "remote-current",
  });
  openOptions(view);
  expect(view.getAllByRole("option")).toHaveLength(22);
  expect(
    view
      .getByRole("option", { name: current.title })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.queryByRole("option", { name: "Contact 20" })).toBeNull();
  fireEvent.keyDown(view.getByRole("combobox"), { key: "Escape" });
  fireEvent.click(view.getByRole("button", { name: "Next documents" }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(list.mock.calls[1]?.[0]).toMatchObject({
    containerId: "folder",
    offset: 20,
    limit: 20,
  });
  openOptions(view);
  expect(await view.findByRole("option", { name: "Contact 22" })).toBeTruthy();
  expect(view.getAllByRole("option")).toHaveLength(5);
  expect(view.queryByRole("option", { name: "Contact 0" })).toBeNull();
  expect(
    view
      .getByRole("option", { name: current.title })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(view.getByRole("combobox"), { key: "Escape" });
  expect(
    (view.getByRole("button", { name: "Next documents" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Previous documents" }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  expect(list.mock.calls[2]?.[0]).toMatchObject({ offset: 0, limit: 20 });
  expect(p.setPrimary).not.toHaveBeenCalled();
});

test("unsynced drafts are omitted and empty titles use the dropdown fallback", async () => {
  const p = setup();
  p.documentQueries.listContainerDocumentSidebarWindow = async () => ({
    rows: [
      { ...candidate(0), documentId: null, title: "Unsynced draft" },
      { ...candidate(1), title: "" },
    ],
    totalCount: 2,
  });
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await act(async () => {});
  expect(view.getByText(/first sync/i)).toBeTruthy();
  openOptions(view);
  expect(view.queryByRole("option", { name: "Unsynced draft" })).toBeNull();
  fireEvent.click(
    await view.findByRole("option", { name: "Untitled document" }),
  );
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenCalledWith("folder", "remote-1"),
  );
});

test.each(["read", "metadata-unready", "trash"])(
  "%s hides primary management controls",
  async (reason) => {
    const p = setup();
    p.node = {
      ...node,
      effectiveAccessLevel: reason === "read" ? "read" : "admin",
      metadataReady: reason !== "metadata-unready",
    };
    p.readOnly = reason === "trash";
    const view = render(<ContainerPrimaryDocumentField {...p} />);
    await act(async () => {});
    expect(
      view.queryByRole("combobox", { name: "Primary document" }),
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: /documents|primary/i }),
    ).toBeNull();
    expect(p.setPrimary).not.toHaveBeenCalled();
  },
);

test("list failure still allows clearing an unavailable primary", async () => {
  const p = setup();
  p.documentQueries.loadContainerDocumentSummary = async () => null;
  p.documentQueries.listContainerDocumentSidebarWindow = async () => {
    throw new Error("Candidate list failed");
  };
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await waitFor(() =>
    expect(view.queryByText("Candidate list failed")).not.toBeNull(),
  );
  openOptions(view);
  fireEvent.click(view.getByRole("option", { name: "None" }));
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenCalledWith("folder", null),
  );
});

test("a failed current-title lookup still allows selecting another document", async () => {
  const p = setup();
  p.documentQueries.loadContainerDocumentSummary = async () => {
    throw new Error("Current title unavailable");
  };
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await waitFor(() =>
    expect(view.queryByText(/Current title unavailable/)).not.toBeNull(),
  );
  openOptions(view);
  fireEvent.click(await view.findByRole("option", { name: "Contact 0" }));
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenCalledWith("folder", "remote-0"),
  );
});

test("an open dropdown keeps its choices and title during a sync refresh", async () => {
  const p = setup();
  const initialPage = { rows: [candidate(0)], totalCount: 23 };
  const nextPage = Promise.withResolvers<typeof initialPage>();
  const nextPrimary = Promise.withResolvers<DocumentSummary>();
  p.documentQueries.listContainerDocumentSidebarWindow = mock(() =>
    Promise.resolve(initialPage),
  )
    .mockImplementationOnce(async () => initialPage)
    .mockImplementation(() => nextPage.promise);
  p.documentQueries.loadContainerDocumentSummary = mock(async () => current)
    .mockImplementationOnce(async () => current)
    .mockImplementation(() => nextPrimary.promise);
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await waitFor(() =>
    expect(view.getByRole("combobox").textContent).toContain("Current contact"),
  );
  openOptions(view);
  view.rerender(<ContainerPrimaryDocumentField {...p} revision={1} />);
  expect(view.getByRole("combobox").textContent).toContain("Current contact");
  expect(view.getByRole("option", { name: "Contact 0" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Next documents" })).toBeTruthy();
  expect(view.queryByText("Loading documents…")).toBeNull();
  await act(async () => {
    nextPage.resolve({ rows: [candidate(1)], totalCount: 23 });
    nextPrimary.resolve({ ...current, title: "Updated contact" });
  });
  await waitFor(() =>
    expect(view.getByRole("combobox").textContent).toContain("Updated contact"),
  );
  expect(view.queryByRole("option", { name: "Contact 0" })).toBeNull();
  fireEvent.click(view.getByRole("option", { name: "Contact 1" }));
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenCalledWith("folder", "remote-1"),
  );
});

test("a container without a primary starts at None and can select a document", async () => {
  const p = setup();
  p.node = { ...node, primaryDocumentId: null };
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await act(async () => {});
  expect(
    view.getByRole("combobox", { name: "Primary document" }).textContent,
  ).toContain("None");
  expect(p.documentQueries.loadContainerDocumentSummary).not.toHaveBeenCalled();
  openOptions(view);
  fireEvent.click(await view.findByRole("option", { name: "Contact 0" }));
  await waitFor(() =>
    expect(p.setPrimary).toHaveBeenCalledWith("folder", "remote-0"),
  );
  view.rerender(
    <ContainerPrimaryDocumentField
      {...p}
      node={{ ...p.node, primaryDocumentId: "remote-0" }}
      revision={1}
    />,
  );
  await waitFor(() =>
    expect(view.getByRole("combobox").textContent).toContain("Contact 0"),
  );
});

test.each([0, 1, 20])(
  "a shrinking document count of %i keeps a route back from the second page",
  async (remaining) => {
    const p = setup();
    let totalCount = 23;
    p.documentQueries.listContainerDocumentSidebarWindow = async ({
      offset,
      limit,
    }) => ({
      rows: Array.from(
        { length: Math.max(0, Math.min(limit, totalCount - offset)) },
        (_, index) => candidate(offset + index),
      ),
      totalCount,
    });
    const view = render(<ContainerPrimaryDocumentField {...p} />);
    fireEvent.click(
      await view.findByRole("button", { name: "Next documents" }),
    );
    openOptions(view);
    expect(
      await view.findByRole("option", { name: "Contact 22" }),
    ).toBeTruthy();
    fireEvent.keyDown(view.getByRole("combobox"), { key: "Escape" });
    totalCount = remaining;
    await act(async () => {
      view.rerender(<ContainerPrimaryDocumentField {...p} revision={1} />);
    });
    fireEvent.click(view.getByRole("button", { name: "Previous documents" }));
    openOptions(view);
    if (remaining > 0) {
      fireEvent.click(await view.findByRole("option", { name: "Contact 0" }));
      await waitFor(() =>
        expect(p.setPrimary).toHaveBeenCalledWith("folder", "remote-0"),
      );
    } else {
      expect(
        await view.findByText("No documents in this container."),
      ).toBeTruthy();
      fireEvent.click(view.getByRole("option", { name: "None" }));
      await waitFor(() =>
        expect(p.setPrimary).toHaveBeenCalledWith("folder", null),
      );
    }
  },
);
