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

type Placement = { documentId: string | null };
type ListLinks = (
  ids: readonly string[],
) => Promise<ReadonlyMap<string, readonly string[]>>;
type ListPage<Row> = (id: string) => Promise<readonly Row[] | null>;

async function* linkedRows<Row extends Placement>(
  containerId: string,
  batch: readonly Row[],
  listLinks: ListLinks,
) {
  const links = await listLinks(
    batch.flatMap(({ documentId }) => (documentId ? [documentId] : [])),
  );
  // Tombstone reconciliation also returns summaries for removed placements.
  for (const row of batch) {
    if (row.documentId && links.get(row.documentId)?.includes(containerId))
      yield { containerId, row };
  }
}

async function* discoverPages<Row extends Placement>(
  ids: readonly string[],
  list: ListPage<Row>,
  listLinks: ListLinks,
  deferred: string[],
) {
  for (const containerId of ids) {
    for (;;) {
      const batch = await list(containerId);
      if (!batch) deferred.push(containerId);
      if (!batch?.length) break;
      yield* linkedRows(containerId, batch, listLinks);
    }
  }
}

export async function* discoverSeedDocuments<Row extends Placement>(
  folders: ReadonlyArray<
    Pick<ContainerNode, "id" | "organizationId" | "parentId" | "systemSlot">
  >,
  list: ListPage<Row>,
  listLinks: ListLinks,
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
    yield* discoverPages(remaining, list, listLinks, deferred);
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
