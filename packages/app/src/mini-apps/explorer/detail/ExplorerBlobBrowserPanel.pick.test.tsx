import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ExplorerBlobPickTarget } from "../blob-pick/ExplorerBlobPickProvider";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

afterEach(cleanup);

// rowNumber % 2 === 0 → image/png, so blob-2 is an image and blob-1 is text.
function createBlobRows(): BlobInfo[] {
  return Array.from({ length: 2 }, (_, index) => {
    const rowNumber = index + 1;
    return {
      blobId: `blob-${rowNumber}`,
      byteLength: rowNumber,
      createdAt: null,
      documentCount: 1,
      key: `blob:blob-${rowNumber}`,
      mimeType: rowNumber % 2 === 0 ? "image/png" : "text/plain",
      name: null,
      referenceCount: 0,
      references: [],
      storageKey: `storage-${rowNumber}`,
      updatedAt: `2026-05-17T00:0${index}:00.000Z`,
    };
  });
}

function createBlobStore(): BlobStore {
  return {
    deleteBytes: async () => undefined,
    readBytes: async () => null,
    writeBytes: async () => undefined,
  };
}

const PICK_TARGET: ExplorerBlobPickTarget = {
  containerId: "container-1",
  localId: "local-document-1",
  slotId: "front-image",
  slotLabel: "Front Image",
};

function renderPickPanel(overrides: {
  onCancelBlobPick?: () => void;
  onPickBlob?: (blob: BlobInfo) => void;
}) {
  const rows = createBlobRows();
  return render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
      nodes={[]}
      online={true}
      onBackToSelectionRoute={() => undefined}
      onCancelBlobPick={overrides.onCancelBlobPick ?? (() => undefined)}
      onPickBlob={overrides.onPickBlob ?? (() => undefined)}
      openDocumentInfoRoute={() => undefined}
      pickTarget={PICK_TARGET}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );
}

test("pick mode names the slot and picks an image row instead of opening detail", async () => {
  const picked: BlobInfo[] = [];
  const view = renderPickPanel({
    onPickBlob: (blob) => {
      picked.push(blob);
    },
  });

  // The header reflects the slot being filled, not the blob-browser title.
  await waitFor(() => {
    expect(
      view.getByText("Choose an image blob for Front Image."),
    ).toBeTruthy();
  });

  const imageRow = view.getByRole("button", { name: "blob-2" });
  fireEvent.click(imageRow);

  // A pick resolves the chosen blob rather than navigating to blob detail.
  expect(picked.map((blob) => blob.blobId)).toEqual(["blob-2"]);
  expect(view.queryByText("Blob Metadata")).toBeNull();
});

test("pick mode disables non-image rows", async () => {
  const picked: BlobInfo[] = [];
  const view = renderPickPanel({
    onPickBlob: (blob) => {
      picked.push(blob);
    },
  });

  const textRow = await view.findByRole("button", { name: "blob-1" });
  expect((textRow as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(textRow);
  expect(picked).toEqual([]);
});

test("pick mode cancel abandons the pick", async () => {
  let cancelled = 0;
  const view = renderPickPanel({
    onCancelBlobPick: () => {
      cancelled += 1;
    },
  });

  fireEvent.click(await view.findByRole("button", { name: "Cancel" }));
  expect(cancelled).toBe(1);
});
