import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type {
  BlobByteSource,
  BlobStore,
  DocumentAttachment,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAttachmentImageUrls } from "./useAttachmentImageUrls";

let createdUrls: string[] = [];
let revokedUrls: string[] = [];
let restoreUrls: Array<() => void> = [];

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];
  let next = 0;
  const create = spyOn(URL, "createObjectURL").mockImplementation(() => {
    next += 1;
    const url = `blob:preview-${next}`;
    createdUrls.push(url);
    return url;
  });
  const revoke = spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revokedUrls.push(url);
  });
  restoreUrls = [() => create.mockRestore(), () => revoke.mockRestore()];
});

afterEach(() => {
  cleanup();
  for (const restore of restoreUrls) restore();
});

function image(slotId: string): DocumentAttachment {
  return {
    byteLength: 3,
    contentSha256: slotId.padEnd(64, "0"),
    mimeType: "image/png",
    name: `${slotId}.png`,
    slotId,
  };
}

/** Every read stays open until the test finishes it, like a stalled disk. */
function createControlledStore() {
  const pending = new Map<string, (source: BlobByteSource) => void>();
  const opened: string[] = [];
  const store = {
    openByteSource: (storageKey: string) =>
      new Promise<BlobByteSource>((resolve) => {
        opened.push(storageKey);
        pending.set(storageKey, resolve);
      }),
  } as unknown as BlobStore;
  const finish = async (storageKey: string) => {
    const resolve = pending.get(storageKey);
    if (!resolve) throw new Error(`No read of ${storageKey} is open`);
    pending.delete(storageKey);
    await act(async () => {
      resolve({
        byteLength: 3,
        read: async () => new Uint8Array([1, 2, 3]),
      });
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    });
  };
  return { finish, opened, store };
}

test("an unavailable receipt never holds back a healthy sibling photo", async () => {
  const { finish, store } = createControlledStore();
  const attachments = [image("receipt"), image("photo")];
  const keys = { photo: "blob-photo", receipt: "blob-receipt" };
  const view = renderHook(() =>
    useAttachmentImageUrls(attachments, keys, store),
  );

  await finish("blob-photo");
  expect(view.result.current).toEqual({ photo: "blob:preview-1" });

  // The receipt's late result still appears for the open document.
  await finish("blob-receipt");
  expect(view.result.current).toEqual({
    photo: "blob:preview-1",
    receipt: "blob:preview-2",
  });
});

test("closing or replacing the document never publishes its old file", async () => {
  const { finish, store } = createControlledStore();
  const attachments = [image("photo")];
  const closed = renderHook(() =>
    useAttachmentImageUrls(attachments, { photo: "blob-closed" }, store),
  );
  closed.unmount();
  await finish("blob-closed");
  expect(createdUrls).toEqual([]);

  let keys: Record<string, string> = { photo: "blob-old" };
  const view = renderHook(() =>
    useAttachmentImageUrls(attachments, keys, store),
  );
  keys = { photo: "blob-new" };
  view.rerender();
  await finish("blob-old");
  expect(view.result.current).toEqual({});
  expect(createdUrls).toEqual([]);
  await finish("blob-new");
  expect(view.result.current).toEqual({ photo: "blob:preview-1" });

  view.unmount();
  expect(revokedUrls).toEqual(["blob:preview-1"]);
});

test("reopening documents behind stalled reads keeps native reads bounded", async () => {
  const { finish, opened, store } = createControlledStore();
  const stuck = ["a", "b", "c", "d"].map(image);
  const stuckKeys = Object.fromEntries(
    stuck.map((attachment) => [attachment.slotId, `blob-${attachment.slotId}`]),
  );
  for (let reopen = 0; reopen < 5; reopen += 1) {
    renderHook(() => useAttachmentImageUrls(stuck, stuckKeys, store)).unmount();
  }
  expect(opened).toEqual(["blob-a", "blob-b", "blob-c", "blob-d"]);

  // A different document's healthy image waits for a permit, then loads.
  const healthy = [image("photo")];
  const view = renderHook(() =>
    useAttachmentImageUrls(healthy, { photo: "blob-healthy" }, store),
  );
  expect(opened).toHaveLength(4);
  await finish("blob-a");
  expect(opened).toEqual([
    "blob-a",
    "blob-b",
    "blob-c",
    "blob-d",
    "blob-healthy",
  ]);
  await finish("blob-healthy");
  expect(view.result.current).toEqual({ photo: "blob:preview-1" });
});
