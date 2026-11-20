import { setTimeout as delay } from "node:timers/promises";
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

export function checkSyncedPlacement(
  fixtureKey: string,
  documentId: string,
  accessStateHash: string,
  stored: {
    documentId: string | null;
    accessStateHash?: string | null | undefined;
  } | null,
) {
  if (
    stored?.documentId !== documentId ||
    stored.accessStateHash !== accessStateHash
  )
    throw new Error(
      `Seed placement changed during verification: ${fixtureKey}`,
    );
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
  checkTime: () => void,
) {
  checkTime();
  const links = await listLinks(
    batch.flatMap(({ documentId }) => (documentId ? [documentId] : [])),
  );
  checkTime();
  // Tombstone reconciliation also returns summaries for removed placements.
  for (const row of batch) {
    checkTime();
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
) {
  let retryAt: number | null = null;
  const batch = await list(folder.id, (delay) => {
    retryAt = now() + Math.max(1, delay);
  });
  let outcome: PageOutcome;
  if (retryAt !== null) outcome = { status: "deferred", retryAt };
  else if (batch === null) outcome = { status: "unavailable" };
  else outcome = { status: batch.length ? "more" : "finished" };
  return { batch, outcome };
}

function checkDiscoveryTime(folder: string, now: number, deadline: number) {
  if (now >= deadline)
    throw new Error(`Document discovery timed out in ${folder}.`);
}

export async function* discoverSeedDocuments<Row extends Placement>(
  folderIds: readonly string[],
  list: ListPage<Row>,
  listLinks: ListLinks,
  clock: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    signal?: AbortSignal;
  } = {},
) {
  const now = clock.now ?? Date.now;
  const sleep =
    clock.sleep ??
    ((ms: number) => delay(ms, undefined, { signal: clock.signal }));
  const remaining: FolderRead[] = folderIds.map((id) => ({
    id,
    status: "ready",
    retryAt: 0,
  }));
  // Persistent head verification can defer a folder for 15 minutes. Give other
  // folders a turn and observe the SDK delay without polling a held head.
  const end = now() + DISCOVERY_TIMEOUT_MS;
  while (remaining.length) {
    remaining.sort((a, b) => a.retryAt - b.retryAt);
    const next = remaining.shift();
    if (!next) return;
    const started = now();
    const checkTime = () => {
      clock.signal?.throwIfAborted();
      checkDiscoveryTime(next.id, now(), end);
    };
    checkTime();
    checkDiscoveryTime(next.id, Math.max(next.retryAt, started), end);
    if (next.retryAt > started) await sleep(next.retryAt - started);
    checkTime();
    const { batch, outcome } = await readFolderPage(next, list, now);
    checkTime();
    if (batch?.length) yield* linkedRows(next.id, batch, listLinks, checkTime);
    const followup = nextFolderRead(next, outcome, now());
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
