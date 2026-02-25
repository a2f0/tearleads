import { isRecord } from '@tearleads/shared';
import type { VfsCrdtCompactionPlan } from './vfsCrdtCompaction.js';

export interface VfsCrdtCompactionRunMetric {
  metricVersion: 1;
  event: 'vfs_crdt_compaction_run';
  occurredAt: string;
  success: boolean;
  executed: boolean;
  durationMs: number;
  cutoffOccurredAt: string | null;
  estimatedRowsToDelete: number;
  deletedRows: number;
  activeClientCount: number;
  staleClientCount: number;
  staleClientIds: string[];
  staleClientIdsTruncatedCount: number;
  malformedClientStateCount: number;
  blockedReason: 'malformedClientState' | null;
  error: string | null;
}

export function isVfsCrdtCompactionRunMetric(
  value: unknown
): value is VfsCrdtCompactionRunMetric {
  if (!isRecord(value)) {
    return false;
  }

  const metricVersion = value['metricVersion'];
  const event = value['event'];
  const occurredAt = value['occurredAt'];
  const success = value['success'];
  const executed = value['executed'];
  const durationMs = value['durationMs'];
  const cutoffOccurredAt = value['cutoffOccurredAt'];
  const estimatedRowsToDelete = value['estimatedRowsToDelete'];
  const deletedRows = value['deletedRows'];
  const activeClientCount = value['activeClientCount'];
  const staleClientCount = value['staleClientCount'];
  const staleClientIds = value['staleClientIds'];
  const staleClientIdsTruncatedCount = value['staleClientIdsTruncatedCount'];
  const malformedClientStateCount = value['malformedClientStateCount'];
  const blockedReason = value['blockedReason'];
  const error = value['error'];

  if (metricVersion !== 1 || event !== 'vfs_crdt_compaction_run') {
    return false;
  }

  if (
    typeof occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(occurredAt))
  ) {
    return false;
  }

  if (typeof success !== 'boolean' || typeof executed !== 'boolean') {
    return false;
  }

  if (
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return false;
  }

  if (
    cutoffOccurredAt !== null &&
    (typeof cutoffOccurredAt !== 'string' ||
      !Number.isFinite(Date.parse(cutoffOccurredAt)))
  ) {
    return false;
  }

  if (
    typeof estimatedRowsToDelete !== 'number' ||
    !Number.isFinite(estimatedRowsToDelete) ||
    estimatedRowsToDelete < 0
  ) {
    return false;
  }

  if (
    typeof deletedRows !== 'number' ||
    !Number.isFinite(deletedRows) ||
    deletedRows < 0
  ) {
    return false;
  }

  if (
    typeof activeClientCount !== 'number' ||
    !Number.isFinite(activeClientCount) ||
    activeClientCount < 0
  ) {
    return false;
  }

  if (
    typeof staleClientCount !== 'number' ||
    !Number.isFinite(staleClientCount) ||
    staleClientCount < 0
  ) {
    return false;
  }

  if (
    !Array.isArray(staleClientIds) ||
    staleClientIds.some((entry) => typeof entry !== 'string')
  ) {
    return false;
  }

  if (
    typeof staleClientIdsTruncatedCount !== 'number' ||
    !Number.isFinite(staleClientIdsTruncatedCount) ||
    staleClientIdsTruncatedCount < 0
  ) {
    return false;
  }

  if (
    typeof malformedClientStateCount !== 'number' ||
    !Number.isFinite(malformedClientStateCount) ||
    malformedClientStateCount < 0
  ) {
    return false;
  }

  if (blockedReason !== null && blockedReason !== 'malformedClientState') {
    return false;
  }

  if (error !== null && typeof error !== 'string') {
    return false;
  }

  return true;
}

export function buildVfsCrdtCompactionRunMetric(input: {
  plan: VfsCrdtCompactionPlan;
  executed: boolean;
  success: boolean;
  deletedRows: number;
  durationMs: number;
  error?: unknown;
  occurredAt?: Date;
}): VfsCrdtCompactionRunMetric {
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === 'string'
        ? input.error
        : null;

  return {
    metricVersion: 1,
    event: 'vfs_crdt_compaction_run',
    occurredAt,
    success: input.success,
    executed: input.executed,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    cutoffOccurredAt: input.plan.cutoffOccurredAt,
    estimatedRowsToDelete: input.plan.estimatedRowsToDelete,
    deletedRows: Math.max(0, Math.trunc(input.deletedRows)),
    activeClientCount: input.plan.activeClientCount,
    staleClientCount: input.plan.staleClientCount,
    staleClientIds: input.plan.staleClientIds,
    staleClientIdsTruncatedCount: input.plan.staleClientIdsTruncatedCount,
    malformedClientStateCount: input.plan.malformedClientStateCount,
    blockedReason: input.plan.blockedReason,
    error: errorMessage
  };
}

export function emitVfsCrdtCompactionRunMetric(
  metric: VfsCrdtCompactionRunMetric
): void {
  console.error(JSON.stringify(metric));
}
