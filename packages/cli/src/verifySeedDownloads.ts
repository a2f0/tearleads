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
type ListPage<Row> = (
  id: string,
  onPending: (delayMs: number) => void,
) => Promise<readonly Row[] | null>;

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

type FolderRead = {
  id: string;
  retryAt: number;
  unavailable?: { since: number; attempts: number };
};

function retryFolder(
  folder: FolderRead,
  delay: number | null,
  now: number,
): FolderRead {
  if (delay !== null)
    return { id: folder.id, retryAt: now + Math.max(1, delay) };
  const { since, attempts } = folder.unavailable ?? { since: now, attempts: 0 };
  const until = since + 30_000;
  if (now >= until)
    throw new Error(`Could not finish discovery in folder ${folder.id}.`);
  return {
    id: folder.id,
    retryAt: Math.min(until, now + Math.min(250 * 2 ** attempts, 2_000)),
    unavailable: { since, attempts: attempts + 1 },
  };
}

export async function* discoverSeedDocuments<Row extends Placement>(
  folders: ReadonlyArray<
    Pick<ContainerNode, "id" | "organizationId" | "parentId" | "systemSlot">
  >,
  list: ListPage<Row>,
  listLinks: ListLinks,
  clock = { now: () => Date.now(), sleep: (ms: number) => Bun.sleep(ms) },
) {
  const byId = new Map(folders.map((node) => [node.id, node]));
  const remaining: FolderRead[] = folders
    .filter(
      (node) =>
        !isContainerUnderTrashByLookup(byId, node.id, {
          currentOrganizationId: node.organizationId,
          trashSystemSlot: null,
        }),
    )
    .map(({ id }) => ({ id, retryAt: 0 }));
  // Persistent head verification can defer a folder for 15 minutes. Give other
  // folders a turn and observe the SDK delay without polling a held head.
  const end = clock.now() + 60 * 60_000;
  while (remaining.length) {
    remaining.sort((a, b) => a.retryAt - b.retryAt);
    const next = remaining.shift();
    if (!next) return;
    const now = clock.now();
    if (next.retryAt > end || now >= end)
      throw new Error(`Document discovery timed out in ${next.id}.`);
    if (next.retryAt > now) await clock.sleep(next.retryAt - now);
    let retryDelay: number | null = null;
    const batch = await list(next.id, (delay) => {
      retryDelay = delay;
    });
    if (batch?.length) {
      yield* linkedRows(next.id, batch, listLinks);
      remaining.unshift({ id: next.id, retryAt: 0 });
    } else if (!batch || retryDelay !== null) {
      remaining.push(retryFolder(next, retryDelay, clock.now()));
    }
  }
}
