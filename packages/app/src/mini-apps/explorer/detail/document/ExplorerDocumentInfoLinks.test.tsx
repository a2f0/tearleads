import { afterEach, expect, test } from "bun:test";
import type { DocumentInfo, DocumentSummary } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import {
  type DocumentInfoPanelTestInput,
  documentInfo,
  documentSummary,
  renderDocumentInfoPanel,
} from "./ExplorerDocumentInfoPanel.testFixtures";

/**
 * The Links tab lists where a document is placed (Linked Containers) and the
 * signed folder chains that grant access to it (Authorizing Containers). Both
 * are unbordered lists whose rows carry the shared row actions menu, opened by
 * the kebab or a right-click, in windowed and routed layouts alike.
 */

const LEAF_MANIFEST_HASH = "manifest-hash-0123456789abcdef";
const MISSING_CONTAINER_ID = "550e8400-e29b-41d4-a716-446655440099";

const linksDocumentInfo = {
  ...documentInfo,
  remoteInfo: {
    ...documentInfo.remoteInfo,
    authorizingContainerPaths: [
      {
        containerId: "archive-container",
        containerKeyEpoch: 4,
        containerKeyEpochId: "epoch-id-4",
        leafManifestHash: LEAF_MANIFEST_HASH,
        organizationId: "org-1",
        pathLength: 2,
      },
      {
        containerId: MISSING_CONTAINER_ID,
        containerKeyEpoch: null,
        containerKeyEpochId: null,
        leafManifestHash: null,
        organizationId: "org-1",
        pathLength: 1,
      },
    ],
  },
} satisfies DocumentInfo;

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
});

async function renderLinksTab(
  input: Partial<DocumentInfoPanelTestInput> = {},
): Promise<RenderResult> {
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    loadDocumentInfo: async () => linksDocumentInfo,
    ...input,
  });
  fireEvent.click(view.getByRole("tab", { name: "Links" }));
  await view.findByRole("list", { name: "Authorizing Containers" });
  return view;
}

function getMenu(): HTMLElement {
  const menu = document.body.querySelector<HTMLElement>(".menu");
  if (!menu) {
    throw new Error("Expected an open row actions menu.");
  }
  return menu;
}

function authorizingList(view: RenderResult): HTMLElement {
  return view.getByRole("list", { name: "Authorizing Containers" });
}

function linkedList(view: RenderResult): HTMLElement {
  return view.getByRole("list", { name: "Linked Containers" });
}

test("both sections render as lists with hints, not tables", async () => {
  const view = await renderLinksTab();

  expect(view.container.querySelector("table")).toBeNull();
  expect(view.getByText("Folders this document appears in.")).toBeTruthy();
  expect(
    view.getByText("Signed folder chains that grant access to this document."),
  ).toBeTruthy();
  expect(
    within(linkedList(view))
      .getAllByRole("listitem")
      .map((row) => row.textContent),
  ).toEqual(["Root", "Archive"]);
  expect(view.queryByText("Lane")).toBeNull();
  expect(view.queryByText("Cursor")).toBeNull();
  expect(view.queryByText(/path entr/)).toBeNull();
});

test("authorizing rows show levels, manifest, and key epoch metadata", async () => {
  const view = await renderLinksTab();
  const [archiveRow, missingRow] = within(authorizingList(view)).getAllByRole(
    "listitem",
  );
  if (!archiveRow || !missingRow) {
    throw new Error("Expected two authorizing rows.");
  }

  expect(archiveRow.textContent).toBe(
    "Archive2 levels · manifest manifest-h...abcdef · epoch 4",
  );
  expect(
    within(archiveRow).getByTitle(`Manifest: ${LEAF_MANIFEST_HASH}`),
  ).toBeTruthy();
  expect(within(archiveRow).getByTitle("Key epoch: epoch-id-4")).toBeTruthy();
  expect(within(archiveRow).getByTitle("Path: 2 levels")).toBeTruthy();
  // An unknown container falls back to its compact id, full id in the title.
  expect(missingRow.textContent).toBe(
    "550e8400-e...440099" + "1 level · manifest -",
  );
  expect(within(missingRow).getByTitle(MISSING_CONTAINER_ID)).toBeTruthy();
});

for (const layout of ["windowed", "routed"] as const) {
  test(`row actions open the menu by kebab and right-click (${layout})`, async () => {
    if (layout === "routed") {
      document.documentElement.setAttribute("data-navigation-mode", "routed");
    }
    const view = await renderLinksTab();

    fireEvent.click(
      within(linkedList(view)).getByRole("button", {
        name: "Actions for Archive",
      }),
    );
    expect(
      within(getMenu())
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual(["Go to container", "Detach…"]);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(document.body.querySelector(".menu")).toBeNull(),
    );

    const [authorizingRow] = within(authorizingList(view)).getAllByRole(
      "listitem",
    );
    if (!authorizingRow) {
      throw new Error("Expected an authorizing row.");
    }
    fireEvent.contextMenu(authorizingRow, { clientX: 20, clientY: 30 });
    expect(
      within(getMenu())
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual(["Go to container"]);
  });
}

function trackUnlinks() {
  const unlinks: Array<[string, string]> = [];
  const unlinkDocument = async (
    documentId: string,
    containerId: string,
  ): Promise<DocumentSummary | null> => {
    unlinks.push([documentId, containerId]);
    return documentSummary;
  };
  return { unlinkDocument, unlinks };
}

async function openDetachDialog(view: RenderResult): Promise<HTMLElement> {
  fireEvent.click(
    within(linkedList(view)).getByRole("button", {
      name: "Actions for Archive",
    }),
  );
  fireEvent.click(within(getMenu()).getByRole("button", { name: "Detach…" }));
  return view.findByRole("dialog", { name: "Detach from Archive?" });
}

test("cancelling the detach confirmation never unlinks", async () => {
  const { unlinkDocument, unlinks } = trackUnlinks();
  const view = await renderLinksTab({ unlinkDocument });

  const dialog = await openDetachDialog(view);
  expect(
    within(dialog).getByText(/The document stays in its other folders\./),
  ).toBeTruthy();
  expect(unlinks).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(view.queryByRole("dialog")).toBeNull();
  expect(unlinks).toEqual([]);
});

test("confirming the detach unlinks exactly once", async () => {
  const { unlinkDocument, unlinks } = trackUnlinks();
  const view = await renderLinksTab({ unlinkDocument });

  const dialog = await openDetachDialog(view);
  // The unlink settles in a promise chain; act flushes it and the dialog's
  // close before asserting.
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Detach" }));
  });

  expect(view.queryByRole("dialog")).toBeNull();
  expect(unlinks).toEqual([["local-document-1", "archive-container"]]);
});

test("detach stays disabled when the document has only one link", async () => {
  const soloSummary = { ...documentSummary, documentId: "document-solo" };
  const view = await renderLinksTab({
    fallbackDocumentSummary: soloSummary,
    loadDocumentSummary: async () => soloSummary,
  });
  expect(within(linkedList(view)).getAllByRole("listitem")).toHaveLength(1);

  fireEvent.click(
    within(linkedList(view)).getByRole("button", { name: "Actions for Root" }),
  );
  const detach = within(getMenu()).getByRole("button", { name: "Detach…" });
  expect(detach.hasAttribute("disabled")).toBe(true);
});

test("go to container opens the authorizing container in Explorer", async () => {
  const selected: Array<string | null> = [];
  const view = await renderLinksTab({
    setSelectedId: (id) => selected.push(id),
  });
  const [archiveRow, missingRow] = within(authorizingList(view)).getAllByRole(
    "listitem",
  );
  if (!archiveRow || !missingRow) {
    throw new Error("Expected two authorizing rows.");
  }

  fireEvent.click(
    within(missingRow).getByRole("button", { name: /^Actions for / }),
  );
  const unavailable = within(getMenu()).getByRole("button", {
    name: "Go to container",
  });
  expect(unavailable.hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(document.body.querySelector(".menu")).toBeNull());

  fireEvent.click(
    within(archiveRow).getByRole("button", { name: "Actions for Archive" }),
  );
  fireEvent.click(
    within(getMenu()).getByRole("button", { name: "Go to container" }),
  );

  expect(selected).toEqual(["archive-container"]);
  expect(document.body.querySelector(".menu")).toBeNull();
});
