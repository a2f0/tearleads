import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed when hydrated container clock is ahead of persisted sync cursor and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.replaySnapshot.cursor = {
      changedAt: '2026-02-14T14:13:00.000Z',
      changeId: 'desktop-1'
    };
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:13:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };
    persisted.containerClocks = [
      {
        containerId: 'item-ahead',
        changedAt: '2026-02-14T14:13:01.000Z',
        changeId: 'desktop-2'
      }
    ];

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks\[0\] is ahead of persisted sync cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'state.containerClocks[0] is ahead of persisted sync cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated container clocks contain duplicate container ids and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.containerClocks = [
      {
        containerId: 'item-dup',
        changedAt: '2026-02-14T14:14:00.000Z',
        changeId: 'desktop-1'
      },
      {
        containerId: 'item-dup',
        changedAt: '2026-02-14T14:14:01.000Z',
        changeId: 'desktop-2'
      }
    ];

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks has duplicate containerId item-dup/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'state.containerClocks has duplicate containerId item-dup'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated container clocks are present without a persisted cursor and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.containerClocks = [
      {
        containerId: 'item-orphan-clock',
        changedAt: '2026-02-14T14:15:00.000Z',
        changeId: 'desktop-1'
      }
    ];
    persisted.replaySnapshot.cursor = null;
    persisted.reconcileState = null;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks requires persisted replay or reconcile cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.containerClocks requires persisted replay or reconcile cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });
});
