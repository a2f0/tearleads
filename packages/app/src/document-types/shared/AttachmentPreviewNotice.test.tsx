import { afterEach, expect, jest, test } from "bun:test";
import {
  type BlobStore,
  createDomainScope,
  type DomainScope,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  ATTACHMENT_PREVIEW_NOTICE_LABELS,
  AttachmentPreviewNotice,
  reloadAfterSavingDocuments,
} from "./AttachmentPreviewNotice";
import {
  PREVIEW_READ_STALL_MS,
  requestPreviewRead,
} from "./attachmentPreviewReads";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

test("an unresponsive read offers a reload, and a failed read a retry", async () => {
  jest.useFakeTimers();
  let failRead: (error: Error) => void = () => undefined;
  const opened: string[] = [];
  const store = {
    openByteSource: (storageKey: string) => {
      opened.push(storageKey);
      return storageKey === "blob-stuck"
        ? new Promise(() => undefined)
        : new Promise((_, reject) => {
            failRead = reject;
          });
    },
  } as unknown as BlobStore;
  const view = render(
    <AttachmentPreviewNotice
      blobStore={store}
      domainScope={createDomainScope()}
    />,
  );
  expect(view.queryByRole("status")).toBeNull();

  requestPreviewRead(store, "blob-broken", () => undefined);
  await act(async () => {
    failRead(new Error("NotReadableError"));
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
  expect(view.getByRole("status").textContent).toContain(
    ATTACHMENT_PREVIEW_NOTICE_LABELS.failed,
  );
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: ATTACHMENT_PREVIEW_NOTICE_LABELS.retry,
      }),
    );
  });
  expect(view.queryByRole("status")).toBeNull();

  requestPreviewRead(store, "blob-stuck", () => undefined);
  await act(async () => {
    jest.advanceTimersByTime(PREVIEW_READ_STALL_MS);
  });
  expect(view.getByRole("status").textContent).toContain(
    ATTACHMENT_PREVIEW_NOTICE_LABELS.stalled,
  );
  expect(
    view.getByRole("button", { name: ATTACHMENT_PREVIEW_NOTICE_LABELS.reload }),
  ).toBeTruthy();
  expect(opened).toEqual(["blob-broken", "blob-stuck"]);
});

test("reload waits for open documents to save their edits", async () => {
  const domainScope = createDomainScope();
  let pending = true;
  const checked: DomainScope[] = [];
  let reloaded = false;
  const reloading = reloadAfterSavingDocuments(
    domainScope,
    () => {
      reloaded = true;
    },
    (scope) => {
      checked.push(scope);
      return pending;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(reloaded).toBe(false);
  pending = false;
  await reloading;
  expect(reloaded).toBe(true);
  expect(checked.every((scope) => scope === domainScope)).toBe(true);
});
