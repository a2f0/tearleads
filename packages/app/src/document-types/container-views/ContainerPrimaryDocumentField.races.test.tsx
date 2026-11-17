import { afterEach, expect, mock, test } from "bun:test";
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
const summary: DocumentSummary = {
  id: "local-current",
  documentId: "remote-current",
  documentKind: "contact",
  containerId: "folder",
  title: "Current contact",
  updatedAt: "now",
};
function setup() {
  return {
    node,
    scope: createDomainScope(),
    revision: 0,
    readOnly: false,
    logError: mock(() => {}),
    setPrimary: mock(
      async (
        _id: string,
        _documentId: string | null,
      ): Promise<ContainerNode | null> => node,
    ),
    documentQueries: {
      loadContainerDocumentSummary: async () => summary,
      listContainerDocumentSidebarWindow: async () => ({
        rows: [],
        totalCount: 0,
      }),
    } as unknown as ContainerDocumentQueries,
  };
}
async function clearPrimary(view: RenderResult) {
  await waitFor(() =>
    expect(view.getByRole("combobox").textContent).toContain("Current contact"),
  );
  fireEvent.click(view.getByRole("combobox", { name: "Primary document" }));
  fireEvent.click(view.getByRole("option", { name: "None" }));
}

test("a pending save disables repeated selection; failure remains visible and permits retry", async () => {
  const p = setup();
  const pending = Promise.withResolvers<ContainerNode | null>();
  p.setPrimary = mock(() => pending.promise);
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await clearPrimary(view);
  const trigger = view.getByRole("combobox", {
    name: "Primary document",
  }) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(view.queryByRole("listbox")).toBeNull();
  expect(p.setPrimary).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Save rejected")));
  expect(view.getByRole("alert").textContent).toBe("Save rejected");
  expect(trigger.disabled).toBe(false);
  expect(p.logError).toHaveBeenCalledTimes(1);
  p.setPrimary.mockImplementation(async () => ({
    ...node,
    primaryDocumentId: null,
  }));
  await clearPrimary(view);
  await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  expect(p.setPrimary).toHaveBeenCalledTimes(2);
});

test("an SDK refusal reports failure rather than claiming the selection saved", async () => {
  const p = setup();
  p.setPrimary = mock(async () => null);
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await clearPrimary(view);
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain(
      "Primary document was not saved",
    ),
  );
  expect(view.getByRole("combobox").textContent).toContain("Current contact");
  expect(p.logError).toHaveBeenCalledTimes(1);
});

for (const boundary of ["container", "scope"] as const) {
  test.each(["success", "failure"] as const)(
    `a stale save %s after ${boundary} navigation cannot settle the new save`,
    async (outcome) => {
      const p = setup();
      const old = Promise.withResolvers<ContainerNode | null>();
      p.setPrimary = mock(() => old.promise);
      const view = render(<ContainerPrimaryDocumentField {...p} />);
      await clearPrimary(view);
      const next = setup();
      next.node = boundary === "container" ? { ...node, id: "other" } : node;
      next.scope = boundary === "scope" ? createDomainScope() : p.scope;
      const pending = Promise.withResolvers<ContainerNode | null>();
      next.setPrimary = mock(() => pending.promise);
      view.rerender(<ContainerPrimaryDocumentField {...next} />);
      await clearPrimary(view);
      expect(next.setPrimary).toHaveBeenCalledWith(next.node.id, null);
      await act(async () => {
        if (outcome === "failure") old.reject(new Error("Old save failure"));
        else old.resolve({ ...node, primaryDocumentId: null });
      });
      expect(view.queryByRole("alert")).toBeNull();
      expect((view.getByRole("combobox") as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(p.logError).toHaveBeenCalledTimes(outcome === "failure" ? 1 : 0);
      await act(async () => pending.reject(new Error("New save failure")));
      expect(view.getByRole("alert").textContent).toBe("New save failure");
      expect((view.getByRole("combobox") as HTMLButtonElement).disabled).toBe(
        false,
      );
      expect(next.logError).toHaveBeenCalledTimes(1);
    },
  );

  test(`late summary and candidate results cannot cross a ${boundary} boundary`, async () => {
    const p = setup();
    const oldSummary = Promise.withResolvers<DocumentSummary | null>();
    const oldRows = Promise.withResolvers<{
      rows: [];
      totalCount: number;
    }>();
    p.documentQueries.loadContainerDocumentSummary = () => oldSummary.promise;
    p.documentQueries.listContainerDocumentSidebarWindow = () =>
      oldRows.promise;
    const view = render(<ContainerPrimaryDocumentField {...p} />);
    const next = setup();
    next.node = boundary === "container" ? { ...node, id: "other" } : node;
    next.scope = boundary === "scope" ? createDomainScope() : p.scope;
    next.documentQueries.loadContainerDocumentSummary = async () => ({
      ...summary,
      title: "New contact",
    });
    next.documentQueries.listContainerDocumentSidebarWindow = async () => ({
      rows: [
        {
          localId: "new-local",
          documentId: "new-remote",
          documentKind: "contact",
          containerId: next.node.id,
          title: "New candidate",
          updatedAt: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
      ],
      totalCount: 1,
    });
    view.rerender(<ContainerPrimaryDocumentField {...next} />);
    await waitFor(() =>
      expect(view.getByRole("combobox").textContent).toContain("New contact"),
    );
    await act(async () => {
      oldSummary.resolve(summary);
      oldRows.resolve({ rows: [], totalCount: 0 });
    });
    expect(view.getByRole("combobox").textContent).toContain("New contact");
    fireEvent.click(view.getByRole("combobox"));
    expect(
      await view.findByRole("option", { name: "New candidate" }),
    ).toBeTruthy();
    expect(view.queryByRole("option", { name: "Current contact" })).toBeNull();
    expect(next.setPrimary).not.toHaveBeenCalled();
  });
}

test("a failed save after unmount is logged without updating another field", async () => {
  const p = setup();
  const pending = Promise.withResolvers<ContainerNode | null>();
  p.setPrimary = mock(() => pending.promise);
  const view = render(<ContainerPrimaryDocumentField {...p} />);
  await clearPrimary(view);
  view.unmount();
  await act(async () => pending.reject(new Error("Unmounted save failure")));
  expect(p.logError).toHaveBeenCalledTimes(1);
});
