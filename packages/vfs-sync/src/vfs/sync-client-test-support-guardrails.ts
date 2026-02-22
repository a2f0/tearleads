import { expect } from 'vitest';

type GuardrailViolationSnapshot = {
  code: string;
  stage: string;
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

export function toStageCodeSignatures(
  events: Array<{ stage: string; code: string }>
): string[] {
  return events.map((event) => `${event.stage}:${event.code}`);
}

export function createGuardrailViolationCollector(): {
  violations: GuardrailViolationSnapshot[];
  onGuardrailViolation: (violation: GuardrailViolationSnapshot) => void;
} {
  const violations: GuardrailViolationSnapshot[] = [];
  return {
    violations,
    onGuardrailViolation: (violation) => {
      violations.push({
        code: violation.code,
        stage: violation.stage,
        message: violation.message,
        details: violation.details ? { ...violation.details } : undefined
      });
    }
  };
}

export function expectLastWriteIdRegressionViolation(input: {
  violations: GuardrailViolationSnapshot[];
  stage: 'pull' | 'reconcile';
  replicaId: string;
  previousWriteId: number;
  incomingWriteId: number;
}): void {
  const message =
    input.stage === 'pull'
      ? 'pull response regressed replica write-id state'
      : 'reconcile acknowledgement regressed replica write-id state';

  expect(input.violations).toContainEqual({
    code: 'lastWriteIdRegression',
    stage: input.stage,
    message,
    details: {
      replicaId: input.replicaId,
      previousWriteId: input.previousWriteId,
      incomingWriteId: input.incomingWriteId
    }
  });
}

/**
 * Phase E: Standardized guardrail-violation assertion helpers
 *
 * These helpers provide consistent assertion patterns for all guardrail
 * violation types, ensuring telemetry coverage is complete and deterministic.
 */

export function expectPullPageInvariantViolation(input: {
  violations: GuardrailViolationSnapshot[];
  hasMore: boolean;
  itemsLength: number;
}): void {
  expect(input.violations).toContainEqual(
    expect.objectContaining({
      code: 'pullPageInvariantViolation',
      stage: 'pull',
      details: expect.objectContaining({
        hasMore: input.hasMore,
        itemsLength: input.itemsLength
      })
    })
  );
}

export function expectPullDuplicateOpReplayViolation(input: {
  violations: GuardrailViolationSnapshot[];
  opId: string;
}): void {
  expect(input.violations).toContainEqual(
    expect.objectContaining({
      code: 'pullDuplicateOpReplay',
      stage: 'pull',
      details: expect.objectContaining({
        opId: input.opId
      })
    })
  );
}

export function expectPullCursorRegressionViolation(input: {
  violations: GuardrailViolationSnapshot[];
  previousChangedAt: string;
  previousChangeId: string;
  incomingChangedAt: string;
  incomingChangeId: string;
}): void {
  expect(input.violations).toContainEqual(
    expect.objectContaining({
      code: 'pullCursorRegression',
      stage: 'pull',
      details: expect.objectContaining({
        previousChangedAt: input.previousChangedAt,
        previousChangeId: input.previousChangeId,
        incomingChangedAt: input.incomingChangedAt,
        incomingChangeId: input.incomingChangeId
      })
    })
  );
}

export function expectReconcileCursorRegressionViolation(input: {
  violations: GuardrailViolationSnapshot[];
  previousChangedAt: string;
  previousChangeId: string;
  incomingChangedAt: string;
  incomingChangeId: string;
}): void {
  expect(input.violations).toContainEqual(
    expect.objectContaining({
      code: 'reconcileCursorRegression',
      stage: 'reconcile',
      details: expect.objectContaining({
        previousChangedAt: input.previousChangedAt,
        previousChangeId: input.previousChangeId,
        incomingChangedAt: input.incomingChangedAt,
        incomingChangeId: input.incomingChangeId
      })
    })
  );
}

export function expectStaleWriteRecoveryExhaustedViolation(input: {
  violations: GuardrailViolationSnapshot[];
  attempts: number;
  maxAttempts: number;
}): void {
  expect(input.violations).toContainEqual(
    expect.objectContaining({
      code: 'staleWriteRecoveryExhausted',
      stage: 'flush',
      details: expect.objectContaining({
        attempts: input.attempts,
        maxAttempts: input.maxAttempts
      })
    })
  );
}

export function expectHydrateGuardrailViolation(input: {
  violations: GuardrailViolationSnapshot[];
  messagePattern?: RegExp;
}): void {
  const violation = input.violations.find(
    (v) => v.code === 'hydrateGuardrailViolation' && v.stage === 'hydrate'
  );
  expect(violation).toBeDefined();
  if (input.messagePattern && violation) {
    expect(violation.message).toMatch(input.messagePattern);
  }
}

/**
 * Asserts that a violation with the given stage:code signature exists.
 * Use for quick presence checks without validating details.
 */
export function expectGuardrailSignature(input: {
  violations: GuardrailViolationSnapshot[];
  signature: string;
}): void {
  const signatures = toStageCodeSignatures(input.violations);
  expect(signatures).toContain(input.signature);
}

/**
 * Asserts that exactly the given set of stage:code signatures were emitted.
 * Use for exhaustive validation of all guardrails triggered in a test.
 */
export function expectExactGuardrailSignatures(input: {
  violations: GuardrailViolationSnapshot[];
  signatures: string[];
}): void {
  const actual = toStageCodeSignatures(input.violations);
  expect(actual).toEqual(input.signatures);
}
