import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobStore } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BlobInfoTable } from "./BlobInfoTable";

const STORAGE_KEY = "symcrypt.blob-browser:hidden-columns:v3";

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
