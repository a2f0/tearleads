import type { BlobByteSource, ContainerNode } from "@tearleads/client-sdk";
import { isContainerUnderTrashByLookup } from "app/continuity";

export async function checkSeedBytes(
  source: BlobByteSource,
  expected: Uint8Array,
  label: string,
) {
  const mismatch = () => new Error(`Attachment bytes differ: ${label}`);
  if (source.byteLength !== expected.byteLength) throw mismatch();
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < expected.length; offset += chunkSize) {
    const chunk = expected.subarray(offset, offset + chunkSize);
    const downloaded = await source.read(offset, chunk.length);
    if (
      !Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).equals(
        downloaded,
      )
    )
      throw mismatch();
  }
}

type ListPage<Row> = (id: string) => Promise<readonly Row[] | null>;

async function* discoverPages<Row>(
  ids: readonly string[],
  list: ListPage<Row>,
  deferred: string[],
) {
  for (const containerId of ids) {
    for (;;) {
      const batch = await list(containerId);
      if (!batch) deferred.push(containerId);
      if (!batch?.length) break;
      for (const row of batch) yield { containerId, row };
    }
  }
}

export async function* discoverSeedDocuments<Row>(
  folders: ReadonlyArray<
    Pick<ContainerNode, "id" | "organizationId" | "parentId" | "systemSlot">
  >,
  list: ListPage<Row>,
) {
  const byId = new Map(folders.map((node) => [node.id, node]));
  let remaining = folders
    .filter(
      (node) =>
        !isContainerUnderTrashByLookup(byId, node.id, {
          currentOrganizationId: node.organizationId,
          trashSystemSlot: null,
        }),
    )
    .map((node) => node.id);
  let retryDeadline: number | undefined;
  let delay = 250;
  while (remaining.length) {
    const deferred: string[] = [];
    yield* discoverPages(remaining, list, deferred);
    if (!deferred.length) return;
    retryDeadline ??= Date.now() + 30_000;
    const timeLeft = retryDeadline - Date.now();
    if (timeLeft <= 0)
      throw new Error(
        `Could not finish discovery in ${deferred.length} folder(s).`,
      );
    await Bun.sleep(Math.min(timeLeft, delay));
    delay = Math.min(delay * 2, 2_000);
    remaining = deferred;
  }
}
