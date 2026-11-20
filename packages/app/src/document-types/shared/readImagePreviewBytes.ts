import type { BlobStore } from "@tearleads/client-sdk";
import { isAutomaticBlobPreviewAllowed } from "./documentAttachmentUtils";

const readers = new WeakMap<
  BlobStore,
  { count: number; events: EventTarget }
>();
export const MAX_IMAGE_PREVIEW_READS = 4;

function waitForReader(events: EventTarget, deadline: AbortSignal) {
  return new Promise<void>((resolve) => {
    function wake() {
      events.removeEventListener("available", wake);
      deadline.removeEventListener("abort", wake);
      resolve();
    }
    events.addEventListener("available", wake);
    deadline.addEventListener("abort", wake);
  });
}

/** A filesystem read retains its memory allowance until the underlying read settles. */
export async function readImagePreviewBytes(
  store: BlobStore,
  key: string,
  current: () => boolean,
  deadline: AbortSignal,
) {
  const source = await store.openByteSource(key);
  if (!source || !isAutomaticBlobPreviewAllowed(source)) return null;
  let pool = readers.get(store);
  if (!pool) {
    pool = { count: 0, events: new EventTarget() };
    readers.set(store, pool);
  }
  while (
    current() &&
    !deadline.aborted &&
    pool.count >= MAX_IMAGE_PREVIEW_READS
  )
    await waitForReader(pool.events, deadline);
  if (!current() || deadline.aborted) return null;
  pool.count++;
  try {
    return await source.read(0, source.byteLength);
  } finally {
    pool.count--;
    pool.events.dispatchEvent(new Event("available"));
  }
}
