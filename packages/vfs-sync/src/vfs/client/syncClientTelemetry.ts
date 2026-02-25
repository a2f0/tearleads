import type { VfsSyncGuardrailViolation } from './sync-client-utils.js';

export interface VfsSyncGuardrailMetricEvent {
  metricName: 'vfs_sync_guardrail_violation_total';
  value: 1;
  tags: {
    stage: VfsSyncGuardrailViolation['stage'];
    code: VfsSyncGuardrailViolation['code'];
    signature: string;
  };
}

export interface VfsSyncRematerializationMetricEvent {
  metricName: 'vfs_sync_rematerialization_required_total';
  value: 1;
  tags: {
    code: 'crdt_rematerialization_required';
    signature: 'pull:pullRematerializationRequired';
  };
}

export function toGuardrailMetricEvent(
  violation: VfsSyncGuardrailViolation
): VfsSyncGuardrailMetricEvent {
  return {
    metricName: 'vfs_sync_guardrail_violation_total',
    value: 1,
    tags: {
      stage: violation.stage,
      code: violation.code,
      signature: `${violation.stage}:${violation.code}`
    }
  };
}

export function toRematerializationMetricEvent(
  violation: VfsSyncGuardrailViolation
): VfsSyncRematerializationMetricEvent | null {
  if (
    violation.stage !== 'pull' ||
    violation.code !== 'pullRematerializationRequired'
  ) {
    return null;
  }

  return {
    metricName: 'vfs_sync_rematerialization_required_total',
    value: 1,
    tags: {
      code: 'crdt_rematerialization_required',
      signature: 'pull:pullRematerializationRequired'
    }
  };
}
