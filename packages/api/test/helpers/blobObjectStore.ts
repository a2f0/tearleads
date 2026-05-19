import type { BlobObjectStore } from "../../src/adapters/blobObjectStore";

export async function readBlobObjectText(
  store: BlobObjectStore,
  key: string,
): Promise<string | null> {
  const stream = await store.getObjectStream(key);
  return stream ? new Response(stream).text() : null;
}
