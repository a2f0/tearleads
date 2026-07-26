import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BlobInfoTable } from "./BlobInfoTable";

const LEGACY_STORAGE_KEY = "tearleads.explorer.blob-browser:hidden-columns";
const V2_STORAGE_KEY = "tearleads.blob-browser:hidden-columns:v2";
const STORAGE_KEY = "tearleads.blob-browser:hidden-columns:v3";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

const BLOB_STORE: BlobStore = {
  deleteBytes: async () => undefined,
  openByteSource: async () => null,
  readBytes: async () => null,
  writeByteSource: async () => undefined,
  writeBytes: async () => undefined,
};

function createBlob(organizationId: string | null): BlobInfo {
  return {
    blobId: "blob-1",
    byteLength: 12,
    createdAt: null,
    documentCount: 1,
    key: "blob:blob-1",
    mimeType: "text/plain",
    name: "example.txt",
    organizationId,
    referenceCount: 1,
    references: [],
    storageKey: "storage-1",
    updatedAt: null,
  };
}

function renderTable(params?: {
  organizationId?: string | null;
  organizationNamesById?: ReadonlyMap<string, string>;
}) {
  const organizationId =
    params?.organizationId === undefined
      ? "org-personal"
      : params.organizationId;
  const blob = createBlob(organizationId);
  return render(
    <BlobInfoTable
      activeBlob={null}
      blobStore={BLOB_STORE}
      compact={false}
      error={null}
      frameRef={() => undefined}
      isLoading={false}
      online
      onSelectBlob={() => undefined}
      onSort={() => undefined}
      organizationNamesById={params?.organizationNamesById}
      rowHeight={36}
      rowOffset={0}
      rows={[blob]}
      sort={{ direction: "desc", key: "updated" }}
      totalCount={1}
    />,
  );
}

test("organization is hidden by default and can be enabled", () => {
  const view = renderTable({
    organizationNamesById: new Map([["org-personal", "Personal"]]),
  });

  expect(view.queryByRole("columnheader", { name: "Organization" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Columns" }));
  const organizationToggle = view.getByRole("checkbox", {
    name: "Organization Off",
  });
  expect((organizationToggle as HTMLInputElement).checked).toBe(false);

  fireEvent.click(organizationToggle);

  expect(view.getByRole("columnheader", { name: "Organization" })).toBeTruthy();
  const organizationCell = view.getByText("Personal");
  expect(organizationCell.getAttribute("title")).toBe("org-personal");
});

test("organization cell falls back to its id and handles unknown attribution", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  const knownIdView = renderTable({ organizationId: "org-custom" });

  expect(knownIdView.getByText("org-custom")).toBeTruthy();

  cleanup();
  const unknownView = renderTable({ organizationId: null });
  const organizationHeader = unknownView.getByRole("columnheader", {
    name: "Organization",
  });
  const organizationColumnIndex = Array.from(
    organizationHeader.parentElement?.children ?? [],
  ).indexOf(organizationHeader);
  const row = unknownView.getByRole("button", { name: "blob-1" }).closest("tr");
  expect(row?.children[organizationColumnIndex]?.textContent).toBe("-");
});

test("legacy visibility preferences migrate while hiding organization", () => {
  globalThis.localStorage.setItem(
    LEGACY_STORAGE_KEY,
    JSON.stringify(["mime", "updated"]),
  );

  const view = renderTable();

  // The user's own two choices survive; each default that changed after they
  // were saved joins them.
  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(
    JSON.stringify(["mime", "updated", "organization", "sync"]),
  );
  fireEvent.click(view.getByRole("button", { name: "Columns" }));
  expect(
    (
      view.getByRole("checkbox", {
        name: "MIME Off",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(
    (
      view.getByRole("checkbox", {
        name: "Updated Off",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(
    (
      view.getByRole("checkbox", {
        name: "Organization Off",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
});

test("an existing preference picks up the newly hidden sync column", () => {
  // A stored preference is the complete hidden set, so the sync column becoming
  // hidden by default has to reach the sets already saved — a user who had once
  // opened the columns menu would otherwise keep the badge forever.
  globalThis.localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(["mime"]));

  renderTable();

  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(
    JSON.stringify(["mime", "sync"]),
  );
});

test("a migrated preference is not re-migrated over the user's own choice", () => {
  // Re-enabling sync must stick: the current key existing is itself the
  // "already migrated" answer.
  globalThis.localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(["mime"]));
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(["mime"]));

  renderTable();

  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(
    JSON.stringify(["mime"]),
  );
});
