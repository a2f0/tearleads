import { afterEach, expect, jest, test } from "bun:test";
import type { BlobByteSource, BlobStore } from "@tearleads/client-sdk";
import {
  activePreviewReadCount,
  getPreviewReadHealth,
  PREVIEW_READ_PERMITS,
  PREVIEW_READ_STALL_MS,
  type PreviewReadResult,
  requestPreviewRead,
  retryFailedPreviewReads,
} from "./attachmentPreviewReads";

afterEach(() => {
  jest.useRealTimers();
});

/** A blob store whose reads settle only when the test says so. */
function createControlledStore() {
  const pending = new Map<
    string,
    Array<{
      resolve: (source: BlobByteSource | null) => void;
      reject: (error: Error) => void;
    }>
  >();
  const opened: string[] = [];
  const store: Pick<BlobStore, "openByteSource"> = {
    openByteSource: (storageKey) =>
      new Promise((resolve, reject) => {
        opened.push(storageKey);
        const waiting = pending.get(storageKey) ?? [];
        waiting.push({ reject, resolve });
        pending.set(storageKey, waiting);
      }),
  };
  const finish = async (storageKey: string, bytes: number[] | Error) => {
    const next = pending.get(storageKey)?.shift();
    if (!next) throw new Error(`No read of ${storageKey} is open`);
    if (bytes instanceof Error) next.reject(bytes);
    else
      next.resolve({
        byteLength: bytes.length,
        read: async () => new Uint8Array(bytes),
      });
    // Let the read's continuations and the pool's bookkeeping run.
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  };
  return { finish, opened, store };
}

function collect() {
  const results: PreviewReadResult[] = [];
  return {
    listener: (result: PreviewReadResult) => results.push(result),
    results,
  };
}

test("no more than four filesystem reads run, and queued reads follow", async () => {
  const { finish, opened, store } = createControlledStore();
  const reads = ["a", "b", "c", "d", "e"].map((key) => {
    const sink = collect();
    requestPreviewRead(store, key, sink.listener);
    return sink;
  });
  expect(PREVIEW_READ_PERMITS).toBe(4);
  expect(opened).toEqual(["a", "b", "c", "d"]);
  expect(activePreviewReadCount(store)).toBe(4);

  await finish("b", [1, 2]);
  expect(reads[1]?.results).toEqual([
    { bytes: new Uint8Array([1, 2]), status: "read" },
  ]);
  expect(opened).toEqual(["a", "b", "c", "d", "e"]);
  expect(activePreviewReadCount(store)).toBe(4);
});

test("readers of one file share a single filesystem read", async () => {
  const { finish, opened, store } = createControlledStore();
  const first = collect();
  const second = collect();
  requestPreviewRead(store, "photo", first.listener);
  requestPreviewRead(store, "photo", second.listener);
  expect(opened).toEqual(["photo"]);
  await finish("photo", [7]);
  expect(first.results).toHaveLength(1);
  expect(second.results).toHaveLength(1);
});

test("an abandoned read keeps its permit until the filesystem answers", async () => {
  const { finish, opened, store } = createControlledStore();
  const releases = ["a", "b", "c", "d"].map((key) =>
    requestPreviewRead(store, key, () => undefined),
  );
  for (const release of releases) release();
  // Closing the document cannot cancel a started read: new reads wait.
  const healthy = collect();
  const releaseQueued = requestPreviewRead(store, "e", healthy.listener);
  expect(opened).toEqual(["a", "b", "c", "d"]);
  // A queued read nobody wants any more never starts.
  releaseQueued();
  requestPreviewRead(store, "f", healthy.listener);
  await finish("a", [1]);
  expect(opened).toEqual(["a", "b", "c", "d", "f"]);
  expect(activePreviewReadCount(store)).toBe(4);
});

test("a read open past the stall window is reported until it settles", async () => {
  jest.useFakeTimers();
  const { finish, store } = createControlledStore();
  requestPreviewRead(store, "receipt", () => undefined);
  expect(getPreviewReadHealth(store).stalledReads).toBe(0);
  jest.advanceTimersByTime(PREVIEW_READ_STALL_MS);
  expect(getPreviewReadHealth(store).stalledReads).toBe(1);
  await finish("receipt", [1]);
  expect(getPreviewReadHealth(store).stalledReads).toBe(0);
});

test("failures count while a preview wants them and a retry re-arms them", async () => {
  const { finish, opened, store } = createControlledStore();
  const sink = collect();
  const release = requestPreviewRead(store, "broken", sink.listener);
  await finish("broken", new Error("NotReadableError"));
  expect(sink.results).toEqual([{ status: "failed" }]);
  expect(getPreviewReadHealth(store).failedReads).toBe(1);

  const generation = getPreviewReadHealth(store).retryGeneration;
  retryFailedPreviewReads(store);
  expect(getPreviewReadHealth(store)).toMatchObject({
    failedReads: 0,
    retryGeneration: generation + 1,
  });
  const releaseRetry = requestPreviewRead(store, "broken", sink.listener);
  expect(opened).toEqual(["broken", "broken"]);
  await finish("broken", new Error("NotReadableError"));
  expect(getPreviewReadHealth(store).failedReads).toBe(1);
  // Once no open preview wants the file, its failure is not reported.
  release();
  expect(getPreviewReadHealth(store).failedReads).toBe(1);
  releaseRetry();
  expect(getPreviewReadHealth(store).failedReads).toBe(0);
});
