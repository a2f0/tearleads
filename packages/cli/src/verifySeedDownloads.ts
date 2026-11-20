import type { BlobByteSource, ContainerNode } from "@tearleads/client-sdk";
import { isContainerUnderTrashByLookup } from "app/continuity";

export async function checkSeedBytes(
  source: BlobByteSource,
  expected: Uint8Array,
  label: string,
  signal?: AbortSignal,
) {
  const mismatch = () => new Error(`Attachment bytes differ: ${label}`);
  if (source.byteLength !== expected.byteLength) throw mismatch();
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < expected.length; offset += chunkSize) {
    const chunk = expected.subarray(offset, offset + chunkSize);
    signal?.throwIfAborted();
    const downloaded = await source.read(offset, chunk.length, signal);
    if (
      !Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).equals(
        downloaded,
      )
    )
      throw mismatch();
  }
}

export function hasSeedPlacement(
  links: readonly string[],
  discoveredIn: string,
  expectedFolder: string,
) {
  return links.includes(discoveredIn) && links.includes(expectedFolder);
}

type Placement = { documentId: string | null };
type ListLinks = (
  ids: readonly string[],
) => Promise<ReadonlyMap<string, readonly string[]>>;
type ListPage<Row> = (
  id: string,
  onPending: (delayMs: number) => void,
  signal: AbortSignal,
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
  retryAt: number | null,
  now: number,
): FolderRead {
  if (retryAt !== null) return { id: folder.id, retryAt };
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

const DISCOVERY_TIMEOUT_MS = 60 * 60_000;
export async function beforeSeedDeadline<T>(
  read: Promise<T>,
  signal: AbortSignal,
  message = "Document discovery timed out.",
) {
  const expired = Promise.withResolvers<never>();
  const stop = () => expired.reject(new Error(message));
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([read, expired.promise]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

async function readFolderPage<Row extends Placement>(
  folder: FolderRead,
  list: ListPage<Row>,
  now: () => number,
  deadline: AbortSignal,
) {
  let retryAt: number | null = null;
  const batch = await beforeSeedDeadline(
    list(
      folder.id,
      (delay) => {
        retryAt = now() + Math.max(1, delay);
      },
      deadline,
    ),
    deadline,
  );
  return { batch, retryAt: retryAt as number | null };
}

export async function* discoverSeedDocuments<Row extends Placement>(
  folders: ReadonlyArray<
    Pick<ContainerNode, "id" | "organizationId" | "parentId" | "systemSlot">
  >,
  list: ListPage<Row>,
  listLinks: ListLinks,
  clock = { now: () => Date.now(), sleep: (ms: number) => Bun.sleep(ms) },
  deadline = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
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
  const end = clock.now() + DISCOVERY_TIMEOUT_MS;
  while (remaining.length) {
    remaining.sort((a, b) => a.retryAt - b.retryAt);
    const next = remaining.shift();
    if (!next) return;
    const now = clock.now();
    if (next.retryAt > end || now >= end)
      throw new Error(`Document discovery timed out in ${next.id}.`);
    if (next.retryAt > now)
      await beforeSeedDeadline(clock.sleep(next.retryAt - now), deadline);
    const { batch, retryAt } = await readFolderPage(
      next,
      list,
      clock.now,
      deadline,
    );
    if (batch?.length) {
      yield* linkedRows(next.id, batch, (ids) =>
        beforeSeedDeadline(listLinks(ids), deadline),
      );
      remaining.unshift({
        id: next.id,
        retryAt: retryAt ?? clock.now(),
      });
    } else if (!batch || retryAt !== null) {
      remaining.push(retryFolder(next, retryAt, clock.now()));
    }
  }
}
