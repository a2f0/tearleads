import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('restores persisted state and converges after restart with concurrent updates', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 10,
      pullDelayMs: 4
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 8
    });
    const observerTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 1,
      pullDelayMs: 1
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      {
        pullLimit: 1
      }
    );
    const observer = new VfsBackgroundSyncClient(
      'user-1',
      'observer',
      observerTransport,
      { pullLimit: 3 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:00:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-2',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T13:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-2',
      parentId: 'root',
      childId: 'item-2',
      occurredAt: '2026-02-14T13:00:01.000Z'
    });

    const persistedDesktopState = desktop.exportState();

    /**
     * Guardrail scenario: simulate process restart by constructing a new client
     * instance and hydrating persisted state before any network activity.
     */
    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T14:00:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:00:02.000Z'
    });

    await Promise.all([mobile.flush(), resumedDesktop.flush()]);
    await Promise.all([mobile.sync(), resumedDesktop.sync(), observer.sync()]);

    const serverSnapshot = server.snapshot();
    const resumedSnapshot = resumedDesktop.snapshot();
    const observerSnapshot = observer.snapshot();

    expect(resumedSnapshot.pendingOperations).toBe(0);
    expect(resumedSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(resumedSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(observerSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(observerSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.nextLocalWriteId).toBeGreaterThanOrEqual(
      (serverSnapshot.lastReconciledWriteIds['desktop'] ?? 0) + 1
    );
  });
});
