import { describe, expect, it } from 'vitest';
import {
  toGuardrailMetricEvent,
  toRematerializationMetricEvent
} from './sync-client-telemetry.js';
import type { VfsSyncGuardrailViolation } from './sync-client-utils.js';

describe('sync-client telemetry helpers', () => {
  it('maps guardrail violations to deterministic metric tags', () => {
    const violation: VfsSyncGuardrailViolation = {
      stage: 'pull',
      code: 'pullCursorRegression',
      message: 'pull response regressed local sync cursor'
    };

    expect(toGuardrailMetricEvent(violation)).toEqual({
      metricName: 'vfs_sync_guardrail_violation_total',
      value: 1,
      tags: {
        stage: 'pull',
        code: 'pullCursorRegression',
        signature: 'pull:pullCursorRegression'
      }
    });
  });

  it('produces rematerialization counter event only for rematerialization guardrails', () => {
    const rematerializationViolation: VfsSyncGuardrailViolation = {
      stage: 'pull',
      code: 'pullRematerializationRequired',
      message: 'pull requires re-materialization from canonical state'
    };
    const unrelatedViolation: VfsSyncGuardrailViolation = {
      stage: 'reconcile',
      code: 'lastWriteIdRegression',
      message: 'reconcile acknowledgement regressed replica write-id state'
    };

    expect(toRematerializationMetricEvent(rematerializationViolation)).toEqual({
      metricName: 'vfs_sync_rematerialization_required_total',
      value: 1,
      tags: {
        code: 'crdt_rematerialization_required',
        signature: 'pull:pullRematerializationRequired'
      }
    });
    expect(toRematerializationMetricEvent(unrelatedViolation)).toBeNull();
  });
});
