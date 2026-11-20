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

async function withReadDeadline<T>(work: Promise<T>, retired: AbortSignal) {
  const limit = AbortSignal.any([retired, AbortSignal.timeout(30_000)]);
  const timeout = Promise.withResolvers<null>();
  const expired = () => timeout.resolve(null);
  if (limit.aborted) expired();
  else limit.addEventListener("abort", expired, { once: true });
  try {
    return await Promise.race([work, timeout.promise]);
  } finally {
    limit.removeEventListener("abort", expired);
  }
}

/** Only time filesystem operations. Waiting for a sibling's read has no I/O deadline. */
export async function readImagePreviewBytes(
  store: BlobStore,
  key: string,
  retired: AbortSignal,
) {
  const source = await withReadDeadline(store.openByteSource(key), retired);
  if (!source || !isAutomaticBlobPreviewAllowed(source)) return null;
  let pool = readers.get(store);
  if (!pool) {
    pool = { count: 0, events: new EventTarget() };
    readers.set(store, pool);
  }
  while (!retired.aborted && pool.count >= MAX_IMAGE_PREVIEW_READS)
    await waitForReader(pool.events, retired);
  if (retired.aborted) return null;
  const active = pool;
  const read = async () => {
    active.count++;
    try {
      return await source.read(0, source.byteLength);
    } finally {
      // The caller can time out before the filesystem releases the buffer.
      active.count--;
      active.events.dispatchEvent(new Event("available"));
    }
  };
  return withReadDeadline(read(), retired);
}
