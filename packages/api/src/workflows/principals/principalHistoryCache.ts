import {
  type DatabaseSession,
  databaseTransactionCompletion,
  isDatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { selectPrincipalHistoryIndexNode } from "../../access/read/principalHistoryIndex";
import {
  selectPrincipalHistoryProgress,
  selectPrincipalHistoryProgressForDiscard,
} from "../../access/read/principalHistoryProgress";
import { upsertPrincipalHistoryIndexNodes } from "../../access/write/principalHistoryIndex";
import {
  discardPrincipalHistoryProgress,
  upsertPrincipalHistoryProgress,
} from "../../access/write/principalHistoryProgress";
import { reportBackgroundFailure } from "../../diagnostics/reportBackgroundFailure";

type ProgressRow = NonNullable<
  Awaited<ReturnType<typeof selectPrincipalHistoryProgress>>
>;
type Selection = Parameters<typeof selectPrincipalHistoryProgress>[1];
type ProgressInput = Parameters<typeof upsertPrincipalHistoryProgress>[1];
interface ProgressBuffer {
  readonly resets: Map<string, Selection>;
  readonly nodes: Map<string, PrincipalHistoryIndexNode>;
  readonly saved: Map<string, ProgressRow>;
  readonly discarded: Map<string, string>;
}
const buffers = new WeakMap<DatabaseSession, ProgressBuffer>();

function scopeKey(scope: ProgressInput | Selection): string {
  return JSON.stringify([
    scope.principalType,
    scope.principalId,
    scope.verificationKind,
    scope.inputHash,
    scope.protectionId,
  ]);
}

function transactionBuffer(
  executor: DatabaseSession,
): ProgressBuffer | undefined {
  if (!isDatabaseTransaction(executor)) return undefined;
  const previous = buffers.get(executor);
  if (previous) return previous;
  const buffer: ProgressBuffer = {
    saved: new Map(),
    discarded: new Map(),
    nodes: new Map(),
    resets: new Map(),
  };
  buffers.set(executor, buffer);
  const completion = databaseTransactionCompletion(executor);
  // An unmanaged transaction can reuse its own hints but never publishes them.
  // Managed adapters supply completion only after the outer lock is released.
  completion?.defer(async (committed) => {
    for (const input of buffer.resets.values())
      await discardProgressChunk(completion.root, input);
    for (const [id, progress] of buffer.discarded)
      await discardPrincipalHistoryProgress(completion.root, { id, progress });
    if (committed) {
      await upsertPrincipalHistoryIndexNodes(completion.root, [
        ...buffer.nodes.values(),
      ]);
      for (const row of buffer.saved.values())
        await upsertPrincipalHistoryProgress(completion.root, row);
    }
  }, reportBackgroundFailure);
  return buffer;
}

export async function readBufferedPrincipalHistoryNode(
  executor: DatabaseSession,
  hash: string,
): Promise<PrincipalHistoryIndexNode | null> {
  return (
    transactionBuffer(executor)?.nodes.get(hash) ??
    (await selectPrincipalHistoryIndexNode(executor, hash))
  );
}

export async function saveBufferedPrincipalHistoryNodes(
  executor: DatabaseSession,
  nodes: readonly PrincipalHistoryIndexNode[],
): Promise<void> {
  const buffer = transactionBuffer(executor);
  if (!buffer) return upsertPrincipalHistoryIndexNodes(executor, nodes);
  for (const node of nodes) buffer.nodes.set(node.hash, { ...node });
}

export async function selectBufferedPrincipalHistoryProgress(
  executor: DatabaseSession,
  input: Selection,
): Promise<ProgressRow | null> {
  const buffer = transactionBuffer(executor);
  if (!buffer) return selectPrincipalHistoryProgress(executor, input);
  let latest: ProgressRow | null = null;
  const key = scopeKey(input);
  for (const row of buffer.saved.values())
    if (
      scopeKey(row) === key &&
      row.version <= input.throughVersion &&
      (!latest || row.version > latest.version)
    )
      latest = row;
  if (latest?.version === input.throughVersion) return latest;
  if (buffer.resets.has(key)) return latest;
  const stored = await selectPrincipalHistoryProgress(executor, input);
  if (
    stored &&
    buffer.discarded.get(stored.id) !== stored.progress &&
    (!latest || stored.version > latest.version)
  )
    return stored;
  return latest;
}

async function discardProgressChunk(
  executor: DatabaseSession,
  input: Selection,
): Promise<void> {
  const rows = await selectPrincipalHistoryProgressForDiscard(executor, input);
  for (const row of rows) await discardPrincipalHistoryProgress(executor, row);
}

export async function resetBufferedPrincipalHistoryProgress(
  executor: DatabaseSession,
  input: Selection,
): Promise<void> {
  const buffer = transactionBuffer(executor);
  if (!buffer) return discardProgressChunk(executor, input);
  const key = scopeKey(input);
  buffer.resets.set(key, { ...input });
  for (const [savedKey, row] of buffer.saved)
    if (scopeKey(row) === key) buffer.saved.delete(savedKey);
}

export async function saveBufferedPrincipalHistoryProgress(
  executor: DatabaseSession,
  input: ProgressInput,
): Promise<void> {
  const buffer = transactionBuffer(executor);
  if (!buffer) return upsertPrincipalHistoryProgress(executor, input);
  buffer.saved.set(JSON.stringify([scopeKey(input), input.version]), {
    ...input,
    id: crypto.randomUUID(),
    updatedAt: new Date(),
  });
}

export async function discardBufferedPrincipalHistoryProgress(
  executor: DatabaseSession,
  input: { readonly id: string; readonly progress: string },
): Promise<void> {
  const buffer = transactionBuffer(executor);
  if (!buffer) return discardPrincipalHistoryProgress(executor, input);
  buffer.discarded.set(input.id, input.progress);
  for (const [key, row] of buffer.saved)
    if (row.id === input.id && row.progress === input.progress)
      buffer.saved.delete(key);
}
