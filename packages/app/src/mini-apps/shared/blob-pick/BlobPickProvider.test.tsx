import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobInfoList } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import {
  type DocumentBlobOpenRequest,
  useDocumentBlobOpen,
} from "../../../document-types/shared/DocumentBlobOpenContext";
import { useDocumentBlobPick } from "../../../document-types/shared/DocumentBlobPickContext";
import type { DocumentAttachmentSlot } from "../../../document-types/shared/documentAttachmentUtils";
import { BlobPickProvider, useBlobPick } from "./BlobPickProvider";

afterEach(cleanup);

const SLOT: DocumentAttachmentSlot = {
  label: "Attachment",
  slotId: "note-attachment-blob-pick",
};

const PICKED_BLOB = {
  blobId: "blob-1",
  storageKey: "storage-1",
} as unknown as BlobInfo;

function makeLoadBlobInfo(totalCount: number) {
  return () =>
    Promise.resolve({ rows: [], totalCount } as unknown as BlobInfoList);
}

const OPEN_BLOB_REQUEST = {
  storageKey: "front-storage-key",
} satisfies DocumentBlobOpenRequest;

function OpenBlobProbe() {
  const blobOpen = useDocumentBlobOpen();

  if (!blobOpen) {
    return null;
  }

  return (
    <button type="button" onClick={() => blobOpen.openBlob(OPEN_BLOB_REQUEST)}>
      open blob
    </button>
  );
}

// Drives both seams the Notes wiring relies on: the document-facing seam
// (requestBlobPick/consumeBlobPick/loadPickableBlobCount) and the host-facing
// seam (pickTarget/resolveBlobPick). The provider is mounted WITHOUT route
// callbacks — the Notes mini-app case, where the picker's visibility is derived
// from pickTarget rather than navigation.
function Probe() {
  const host = useBlobPick();
  const doc = useDocumentBlobPick();
  const [consumed, setConsumed] = useState("pending");
  const [count, setCount] = useState(-1);

  if (!doc) {
    return <span data-testid="target">no-provider</span>;
  }

  return (
    <>
      <span data-testid="target">{host.pickTarget?.slotLabel ?? "none"}</span>
      <span data-testid="consumed">{consumed}</span>
      <span data-testid="count">{count}</span>
      <button
        type="button"
        onClick={() =>
          doc.requestBlobPick({ containerId: "c1", localId: "n1", slot: SLOT })
        }
      >
        request
      </button>
      <button type="button" onClick={() => host.resolveBlobPick(PICKED_BLOB)}>
        resolve
      </button>
      <button
        type="button"
        onClick={() =>
          setConsumed(
            doc.consumeBlobPick("n1", SLOT.slotId) === PICKED_BLOB
              ? "hit"
              : "miss",
          )
        }
      >
        consume
      </button>
      <button
        type="button"
        onClick={() => {
          void doc.loadPickableBlobCount().then(setCount);
        }}
      >
        count
      </button>
    </>
  );
}

test("pick round-trip works without route callbacks (Notes mode)", async () => {
  const screen = render(
    <BlobPickProvider loadBlobInfo={makeLoadBlobInfo(3)}>
      <Probe />
    </BlobPickProvider>,
  );

  expect(screen.getByTestId("target").textContent).toBe("none");

  // Requesting a pick records the target (which drives the picker's visibility)
  // even though no openBlobBrowserRoute callback was supplied.
  fireEvent.click(screen.getByText("request"));
  expect(screen.getByTestId("target").textContent).toBe("Attachment");

  // Resolving clears the target and stashes the blob for the document to consume.
  fireEvent.click(screen.getByText("resolve"));
  expect(screen.getByTestId("target").textContent).toBe("none");

  // The document consumes the resolved blob exactly once.
  fireEvent.click(screen.getByText("consume"));
  expect(screen.getByTestId("consumed").textContent).toBe("hit");
});

test("consumeBlobPick returns the blob only once", () => {
  const screen = render(
    <BlobPickProvider loadBlobInfo={makeLoadBlobInfo(0)}>
      <Probe />
    </BlobPickProvider>,
  );

  fireEvent.click(screen.getByText("request"));
  fireEvent.click(screen.getByText("resolve"));
  fireEvent.click(screen.getByText("consume"));
  expect(screen.getByTestId("consumed").textContent).toBe("hit");

  // A second consume finds nothing left.
  fireEvent.click(screen.getByText("consume"));
  expect(screen.getByTestId("consumed").textContent).toBe("miss");
});

test("loadPickableBlobCount surfaces the identity-local blob total", async () => {
  const screen = render(
    <BlobPickProvider loadBlobInfo={makeLoadBlobInfo(7)}>
      <Probe />
    </BlobPickProvider>,
  );

  fireEvent.click(screen.getByText("count"));
  await waitFor(() => {
    expect(screen.getByTestId("count").textContent).toBe("7");
  });
});

test("openBlob forwards the storage-key request to the blob-browser route", () => {
  const openRequests: Array<DocumentBlobOpenRequest | undefined> = [];
  const screen = render(
    <BlobPickProvider
      loadBlobInfo={makeLoadBlobInfo(0)}
      openBlobBrowserRoute={(request) => openRequests.push(request)}
    >
      <OpenBlobProbe />
    </BlobPickProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "open blob" }));

  expect(openRequests).toEqual([OPEN_BLOB_REQUEST]);
  expect(openRequests[0]).toBe(OPEN_BLOB_REQUEST);
});
