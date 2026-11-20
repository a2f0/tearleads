import { afterEach, expect, spyOn, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAttachmentImageUrls } from "./useAttachmentImageUrls";

afterEach(cleanup);

test("each preview settles independently and a late read cannot replace the current key", async () => {
  const blobStore = createMemoryBlobStore();
  await blobStore.writeBytes("old", new Uint8Array([1]));
  await blobStore.writeBytes("new", new Uint8Array([2]));
  const oldSource = await blobStore.openByteSource("old");
  const deferred = Promise.withResolvers<typeof oldSource>();
  const open = blobStore.openByteSource.bind(blobStore);
  let offline = true;
  blobStore.openByteSource = async (key) => {
    if (key === "old") return deferred.promise;
    if (key === "broken" && offline) throw new Error("Read failed");
    return open(key);
  };
  const photoSlot = "photo";
  const receiptSlot = "receipt";
  const attachments = [photoSlot, receiptSlot].map((slotId) => ({
    name: slotId,
    slotId,
    mimeType: "image/png",
    byteLength: 1,
    contentSha256: "0".repeat(64),
  }));
  const { result, rerender } = renderHook(
    ({ photo, syncing }) =>
      useAttachmentImageUrls(
        attachments,
        { photo, receipt: "broken" },
        blobStore,
        syncing,
      ),
    { initialProps: { photo: "old", syncing: false } },
  );
  expect(result.current.loadingPreviewSlots.has(photoSlot)).toBe(true);
  await waitFor(() =>
    expect(result.current.loadingPreviewSlots.has(receiptSlot)).toBe(false),
  );
  expect(result.current.imageUrlBySlotId[receiptSlot]).toBeUndefined();
  rerender({ photo: "new", syncing: true });
  await waitFor(() =>
    expect(result.current.imageUrlBySlotId[photoSlot]).toBeDefined(),
  );
  const current = result.current.imageUrlBySlotId[photoSlot];
  await act(async () => {
    deferred.resolve(oldSource);
    await deferred.promise;
  });
  expect(result.current.imageUrlBySlotId[photoSlot]).toBe(current);
  expect(result.current.loadingPreviewSlots.size).toBe(0);
  offline = false;
  await blobStore.writeBytes("broken", new Uint8Array([3]));
  rerender({ photo: "new", syncing: false });
  await waitFor(() =>
    expect(result.current.imageUrlBySlotId[receiptSlot]).toBeDefined(),
  );
  expect(result.current.imageUrlBySlotId[photoSlot]).toBe(current);
});

test("a failed read that spans a sync completion retries the same file", async () => {
  const store = createMemoryBlobStore();
  await store.writeBytes("held", new Uint8Array([7]));
  const source = await store.openByteSource("held");
  const first = Promise.withResolvers<typeof source>();
  let reads = 0;
  store.openByteSource = async () => (++reads === 1 ? first.promise : source);
  const slot = "photo";
  const attachments = [
    {
      slotId: slot,
      mimeType: "image/png",
      byteLength: 1,
      contentSha256: "1".repeat(64),
      name: "photo",
    },
  ];
  const keys = { photo: "held" };
  const { result, rerender } = renderHook(
    ({ syncing }) => useAttachmentImageUrls(attachments, keys, store, syncing),
    { initialProps: { syncing: true } },
  );
  await waitFor(() => expect(reads).toBe(1));
  rerender({ syncing: false });
  await act(async () => {
    first.resolve(null);
    await first.promise;
  });
  await waitFor(() =>
    expect(result.current.imageUrlBySlotId[slot]).toBeDefined(),
  );
  expect(reads).toBe(2);
});

test("a stalled first image still lets the fifth preview finish", async () => {
  const store = createMemoryBlobStore();
  const attachments = Array.from({ length: 5 }, (_, i) => ({
    slotId: String(i),
    mimeType: "image/png",
    byteLength: 1,
    contentSha256: "0".repeat(64),
    name: String(i),
  }));
  const keys = Object.fromEntries(
    attachments.map(({ slotId }) => [slotId, slotId]),
  );
  for (const { slotId } of attachments)
    await store.writeBytes(slotId, new Uint8Array([7]));
  const open = store.openByteSource.bind(store);
  const blocked = Promise.withResolvers<void>();
  store.openByteSource = async (key) => {
    if (key === "0") await blocked.promise;
    return open(key);
  };
  const { result } = renderHook(() =>
    useAttachmentImageUrls(attachments, keys, store, false),
  );
  try {
    await waitFor(() =>
      expect(result.current.imageUrlBySlotId["4"]).toBeDefined(),
    );
    expect(result.current.loadingPreviewSlots).toEqual(new Set(["0"]));
  } finally {
    await act(async () => blocked.resolve());
  }
});

test("replacing all stalled sources immediately schedules their current previews", async () => {
  const store = createMemoryBlobStore();
  await store.writeBytes("replacement", new Uint8Array([1]));
  const open = store.openByteSource.bind(store);
  const stalled = Promise.withResolvers<void>();
  let opened = 0;
  store.openByteSource = async (key) => {
    if (key === "old") {
      opened++;
      await stalled.promise;
    }
    return open("replacement");
  };
  const attachments = Array.from({ length: 4 }, (_, i) => ({
    slotId: String(i),
    name: String(i),
    mimeType: "image/png",
    byteLength: 1,
    contentSha256: "0".repeat(64),
  }));
  const { result, rerender } = renderHook(
    ({ key }) =>
      useAttachmentImageUrls(
        attachments,
        Object.fromEntries(attachments.map(({ slotId }) => [slotId, key])),
        store,
        false,
      ),
    { initialProps: { key: "old" } },
  );
  try {
    await waitFor(() => expect(opened).toBe(4));
    rerender({ key: "replacement" });
    await waitFor(() =>
      expect(Object.keys(result.current.imageUrlBySlotId)).toHaveLength(4),
    );
  } finally {
    await act(async () => stalled.resolve());
  }
});

test("a fifth preview loads after four filesystem reads time out", async () => {
  const store = createMemoryBlobStore();
  const stalled = Promise.withResolvers<null>();
  const open = store.openByteSource.bind(store);
  await store.writeBytes("ready", new Uint8Array([1]));
  store.openByteSource = (key) =>
    key === "ready" ? open(key) : stalled.promise;
  const deadlines: AbortController[] = [];
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const timer = new AbortController();
    deadlines.push(timer);
    return timer.signal;
  });
  const keys = ["one", "two", "three", "four", "ready"];
  const attachments = keys.map((key) => ({
    slotId: key,
    name: key,
    mimeType: "image/png",
    byteLength: 1,
    contentSha256: "0".repeat(64),
  }));
  const storageKeys = Object.fromEntries(keys.map((key) => [key, key]));
  try {
    const { result } = renderHook(() =>
      useAttachmentImageUrls(attachments, storageKeys, store, false),
    );
    expect(deadlines).toHaveLength(4);
    await act(async () => {
      for (const timer of [...deadlines]) timer.abort();
    });
    await waitFor(() =>
      expect(result.current.imageUrlBySlotId[keys[4] ?? ""]).toBeDefined(),
    );
    expect(result.current.loadingPreviewSlots.size).toBe(0);
    await act(async () => {
      stalled.resolve(null);
    });
    expect(result.current.imageUrlBySlotId[keys[0] ?? ""]).toBeUndefined();
  } finally {
    stalled.resolve(null);
    timeout.mockRestore();
  }
});

test("a sync completed during a timed-out preview gives that slot one more read", async () => {
  const store = createMemoryBlobStore();
  await store.writeBytes("photo", new Uint8Array([1]));
  const open = store.openByteSource.bind(store);
  const stalled = Promise.withResolvers<null>();
  let attempts = 0;
  store.openByteSource = (key) =>
    ++attempts === 1 ? stalled.promise : open(key);
  const first = new AbortController();
  const deadline = spyOn(AbortSignal, "timeout").mockReturnValueOnce(
    first.signal,
  );
  const slots = [
    {
      slotId: "p",
      name: "photo",
      mimeType: "image/png",
      byteLength: 1,
      contentSha256: "0".repeat(64),
    },
  ];
  try {
    const { result, rerender } = renderHook(
      ({ syncing }) =>
        useAttachmentImageUrls(slots, { p: "photo" }, store, syncing),
      { initialProps: { syncing: true } },
    );
    rerender({ syncing: false });
    await act(async () => first.abort());
    await waitFor(() =>
      expect(Object.values(result.current.imageUrlBySlotId)).toHaveLength(1),
    );
    expect(attempts).toBe(2);
  } finally {
    stalled.resolve(null);
    deadline.mockRestore();
  }
});

test("a replacement waits for active byte reads to release memory", async () => {
  const store = createMemoryBlobStore();
  const stalled = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
  let active = 0;
  let maxActive = 0;
  const read = (key: string) => async () => {
    active++;
    maxActive = Math.max(active, maxActive);
    try {
      return key === "old" ? await stalled.promise : new Uint8Array([2]);
    } finally {
      active--;
    }
  };
  store.openByteSource = async (key) => ({ byteLength: 1, read: read(key) });
  const slots = Array.from({ length: 4 }, (_, i) => ({
    slotId: String(i),
    name: String(i),
    mimeType: "image/png",
    byteLength: 1,
    contentSha256: "a".repeat(64),
  }));
  const deadlines: AbortController[] = [];
  const timer = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  const { result, rerender } = renderHook(
    ({ key }) =>
      useAttachmentImageUrls(
        slots,
        Object.fromEntries(slots.map(({ slotId }) => [slotId, key])),
        store,
        false,
      ),
    { initialProps: { key: "old" } },
  );
  try {
    await waitFor(() => expect(active).toBe(4));
    await act(async () => rerender({ key: "new" }));
    expect(maxActive).toBe(4);
    await act(async () => {
      for (const deadline of deadlines) deadline.abort();
    });
  } finally {
    timer.mockRestore();
    await act(async () => stalled.resolve(new Uint8Array([1])));
  }
  await waitFor(() =>
    expect(Object.values(result.current.imageUrlBySlotId)).toHaveLength(4),
  );
});

test("an oversized local source is never read for a small declared photo", async () => {
  const store = createMemoryBlobStore();
  let reads = 0;
  store.openByteSource = async () => ({
    byteLength: 10_000_000,
    read: async () => {
      reads++;
      return new Uint8Array();
    },
  });
  const slot = {
    slotId: "p",
    name: "p",
    mimeType: "image/png",
    byteLength: 1,
    contentSha256: "a".repeat(64),
  };
  const { result } = renderHook(() =>
    useAttachmentImageUrls([slot], { p: "photo" }, store, false),
  );
  await waitFor(() => expect(result.current.loadingPreviewSlots.size).toBe(0));
  expect(reads).toBe(0);
});
