import { isDeepStrictEqual } from "node:util";
import type { BlobByteSource } from "@tearleads/client-sdk";

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

type FolderRead = { id: string; retryAt: number } & (
  | { status: "ready" }
  | { status: "deferred" }
  | { status: "unavailable"; since: number; attempts: number }
);
type PageOutcome =
  | { status: "more" | "finished" | "unavailable" }
  | { status: "deferred"; retryAt: number };

function nextFolderRead(
  folder: FolderRead,
  event: PageOutcome,
  now: number,
): FolderRead | null {
  const { id } = folder;
  if (event.status === "finished") return null;
  if (event.status === "deferred")
    return { id, status: "deferred", retryAt: event.retryAt };
  if (event.status === "more") return { id, status: "ready", retryAt: now };
  const { since, attempts } =
    folder.status === "unavailable" ? folder : { since: now, attempts: 0 };
  const until = since + 30_000;
  if (now >= until)
    throw new Error(`Could not finish discovery in folder ${id}.`);
  return {
    id,
    status: "unavailable",
    since,
    attempts: attempts + 1,
    retryAt: Math.min(until, now + Math.min(250 * 2 ** attempts, 2_000)),
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
  let outcome: PageOutcome;
  if (retryAt !== null) outcome = { status: "deferred", retryAt };
  else if (batch === null) outcome = { status: "unavailable" };
  else outcome = { status: batch.length ? "more" : "finished" };
  return { batch, outcome };
}

export async function* discoverSeedDocuments<Row extends Placement>(
  folderIds: readonly string[],
  list: ListPage<Row>,
  listLinks: ListLinks,
  clock = { now: () => Date.now(), sleep: (ms: number) => Bun.sleep(ms) },
  deadline = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
) {
  const remaining: FolderRead[] = folderIds.map((id) => ({
    id,
    status: "ready",
    retryAt: 0,
  }));
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
    const { batch, outcome } = await readFolderPage(
      next,
      list,
      clock.now,
      deadline,
    );
    if (batch?.length) {
      yield* linkedRows(next.id, batch, (ids) =>
        beforeSeedDeadline(listLinks(ids), deadline),
      );
    }
    const followup = nextFolderRead(next, outcome, clock.now());
    if (!followup) continue;
    if (batch?.length) remaining.unshift(followup);
    else remaining.push(followup);
  }
}

/** Return the local byte source corresponding to each binding seen by the verifier. */
export function verifiedSeedStorageKeys(
  label: string,
  expected: readonly string[],
  bindings: readonly { slotId: string; blobId: string }[] | null,
  held: readonly {
    slotId: string;
    blobId: string | null;
    storageKey: string;
    detachedAt: string | null;
  }[],
  verified: ReadonlyMap<string, unknown>,
) {
  const remaining = new Set(expected);
  const bySlot = new Map(
    held.filter((row) => !row.detachedAt).map((row) => [row.slotId, row]),
  );
  const storageKeys = new Map<string, string>();
  const mismatch = () => new Error(`Attachment bindings differ: ${label}`);
  if (!bindings) throw mismatch();
  for (const binding of bindings) {
    const copy = bySlot.get(binding.slotId);
    if (
      !remaining.delete(binding.slotId) ||
      !copy ||
      !isDeepStrictEqual(verified.get(binding.slotId), binding) ||
      copy.blobId !== binding.blobId
    )
      throw mismatch();
    storageKeys.set(binding.slotId, copy.storageKey);
  }
  if (remaining.size) throw mismatch();
  return storageKeys;
}
