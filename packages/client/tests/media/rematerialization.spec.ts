import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  createNewInstanceFromAnyPage,
  setupDatabaseOnSqlitePage,
  switchToInstanceFromAnyPage
} from '../instanceSwitchingHelpers';
import { clearOriginStorage } from '../testUtils';

const REMATERIALIZED_PHOTO_NAME = 'Tearleads logo.svg';
const REMATERIALIZED_AUDIO_NAME = 'The Blessing.mp3';

const VFS_SERVICE_CONNECT_PATH = '/connect/tearleads.v2.VfsService';
const TEST_USER_ID = 'user-remat-test';

declare global {
  interface Window {
    __TEARLEADS_E2E__?: {
      rematerializeRemoteVfsStateIfNeeded: () => Promise<boolean>;
    };
  }
}

async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
    .toBe(path);
}

function createSyncResponse() {
  return {
    items: [
      {
        changeId: 'change-root',
        itemId: 'root-item',
        changeType: 'upsert',
        changedAt: '2026-01-01T02:00:01.000Z',
        objectType: 'folder',
        encryptedName: 'Root Item',
        ownerId: TEST_USER_ID,
        createdAt: '2026-01-01T02:00:00.000Z',
        accessLevel: 'admin'
      },
      {
        changeId: 'change-album',
        itemId: 'album-item',
        changeType: 'upsert',
        changedAt: '2026-01-01T02:00:02.000Z',
        objectType: 'album',
        encryptedName: 'Photos shared with Alice',
        ownerId: TEST_USER_ID,
        createdAt: '2026-01-01T02:00:02.000Z',
        accessLevel: 'admin'
      },
      {
        changeId: 'change-photo',
        itemId: 'photo-item',
        changeType: 'upsert',
        changedAt: '2026-01-01T02:00:03.000Z',
        objectType: 'photo',
        encryptedName: REMATERIALIZED_PHOTO_NAME,
        ownerId: TEST_USER_ID,
        createdAt: '2026-01-01T02:00:03.000Z',
        accessLevel: 'admin'
      },
      {
        changeId: 'change-playlist',
        itemId: 'playlist-item',
        changeType: 'upsert',
        changedAt: '2026-01-01T02:00:04.000Z',
        objectType: 'playlist',
        encryptedName: 'Music shared with Alice',
        ownerId: TEST_USER_ID,
        createdAt: '2026-01-01T02:00:04.000Z',
        accessLevel: 'admin'
      },
      {
        changeId: 'change-audio',
        itemId: 'audio-item',
        changeType: 'upsert',
        changedAt: '2026-01-01T02:00:05.000Z',
        objectType: 'audio',
        encryptedName: REMATERIALIZED_AUDIO_NAME,
        ownerId: TEST_USER_ID,
        createdAt: '2026-01-01T02:00:05.000Z',
        accessLevel: 'admin'
      }
    ],
    nextCursor: null,
    hasMore: false
  };
}

function createCrdtSyncResponse() {
  const photoPayload = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    'utf8'
  ).toString('base64');
  const audioPayload = Buffer.from('ID3-test-track', 'utf8').toString('base64');

  return {
    items: [
      {
        opId: 'op-photo-state',
        itemId: 'photo-item',
        opType: 'item_upsert',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: TEST_USER_ID,
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'source-photo-state',
        occurredAt: '2026-01-01T02:00:03.100Z',
        encryptedPayload: photoPayload,
        keyEpoch: 1
      },
      {
        opId: 'op-root-album-link',
        itemId: 'album-item',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: 'root-item',
        childId: 'album-item',
        actorId: TEST_USER_ID,
        sourceTable: 'vfs_links',
        sourceId: 'source-root-album-link',
        occurredAt: '2026-01-01T02:00:03.200Z'
      },
      {
        opId: 'op-album-photo-link',
        itemId: 'photo-item',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: 'album-item',
        childId: 'photo-item',
        actorId: TEST_USER_ID,
        sourceTable: 'vfs_links',
        sourceId: 'source-album-photo-link',
        occurredAt: '2026-01-01T02:00:03.300Z'
      },
      {
        opId: 'op-audio-state',
        itemId: 'audio-item',
        opType: 'item_upsert',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: TEST_USER_ID,
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'source-audio-state',
        occurredAt: '2026-01-01T02:00:05.100Z',
        encryptedPayload: audioPayload,
        keyEpoch: 1
      },
      {
        opId: 'op-root-playlist-link',
        itemId: 'playlist-item',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: 'root-item',
        childId: 'playlist-item',
        actorId: TEST_USER_ID,
        sourceTable: 'vfs_links',
        sourceId: 'source-root-playlist-link',
        occurredAt: '2026-01-01T02:00:05.200Z'
      },
      {
        opId: 'op-playlist-audio-link',
        itemId: 'audio-item',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: 'playlist-item',
        childId: 'audio-item',
        actorId: TEST_USER_ID,
        sourceTable: 'vfs_links',
        sourceId: 'source-playlist-audio-link',
        occurredAt: '2026-01-01T02:00:05.300Z'
      }
    ],
    nextCursor: null,
    hasMore: false,
    lastReconciledWriteIds: {}
  };
}

async function mockRematerializationApi(page: Page): Promise<void> {
  const syncResponse = createSyncResponse();
  const crdtResponse = createCrdtSyncResponse();

  await page.route(
    `**${VFS_SERVICE_CONNECT_PATH}/GetSync`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(syncResponse)
      });
    }
  );

  await page.route(
    `**${VFS_SERVICE_CONNECT_PATH}/GetCrdtSync`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(crdtResponse)
      });
    }
  );
}

async function triggerRematerialization(page: Page): Promise<void> {
  const didRematerialize = await page.evaluate(async () => {
    const helpers = window.__TEARLEADS_E2E__;
    if (!helpers) {
      throw new Error('E2E rematerialization helper is unavailable');
    }
    return helpers.rematerializeRemoteVfsStateIfNeeded();
  });

  expect(didRematerialize).toBe(true);
}

async function resolveAudioDropzoneState(
  page: Page
): Promise<'dropzone' | 'error' | 'pending'> {
  const dropzoneText = page.getByText(
    'Drop an audio file here to add it to your library'
  );
  if (await dropzoneText.isVisible().catch(() => false)) {
    return 'dropzone';
  }

  const queryError = page.locator('text=/Failed query:/i').first();
  if (await queryError.isVisible().catch(() => false)) {
    return 'error';
  }

  return 'pending';
}

async function initializeStorageForActiveInstance(page: Page): Promise<void> {
  await navigateInApp(page, '/audio');
  await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible({
    timeout: 10000
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    let state = await resolveAudioDropzoneState(page);
    if (state === 'pending') {
      await expect
        .poll(() => resolveAudioDropzoneState(page), {
          timeout: 10000
        })
        .toMatch(/dropzone|error/);
      state = await resolveAudioDropzoneState(page);
    }

    if (state === 'dropzone') {
      return;
    }

    if (attempt === 0) {
      const refreshButton = page.getByRole('button', { name: 'Refresh' });
      if (await refreshButton.isEnabled().catch(() => false)) {
        await refreshButton.click();
        continue;
      }
    }

    throw new Error('Audio storage initialization did not reach dropzone state');
  }
}

async function assertVfsExplorerShowsRematerializedItems(
  page: Page
): Promise<void> {
  await navigateInApp(page, '/vfs');
  await page.getByText('All Items').first().click();
  await expect(page.getByText(REMATERIALIZED_PHOTO_NAME)).toBeVisible({
    timeout: 20000
  });
  await expect(page.getByText(REMATERIALIZED_AUDIO_NAME)).toBeVisible({
    timeout: 20000
  });
}

async function assertPhotosAppShowsRematerializedPhoto(
  page: Page
): Promise<void> {
  await navigateInApp(page, '/photos');
  await expect(page.getByText('1 photo')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('photos-grid')).toBeVisible({ timeout: 10000 });
}

async function assertAudioAppShowsRematerializedTrack(
  page: Page
): Promise<void> {
  await navigateInApp(page, '/audio');
  await expect(
    page.locator('[data-testid^="audio-track-"]').first()
  ).toBeVisible({
    timeout: 15000
  });
  await expect(page.getByText(REMATERIALIZED_AUDIO_NAME)).toBeVisible({
    timeout: 10000
  });
}

test.describe('VFS rematerialization media visibility', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('keeps rematerialized photo/audio visible after cross-instance storage init', async ({
    page
  }) => {
    test.slow();

    await mockRematerializationApi(page);
    await setupDatabaseOnSqlitePage(page);
    await triggerRematerialization(page);

    await assertVfsExplorerShowsRematerializedItems(page);
    await assertPhotosAppShowsRematerializedPhoto(page);
    await assertAudioAppShowsRematerializedTrack(page);

    // Reproduce stale-storage-instance risk:
    // switch to a second instance and initialize storage there.
    await createNewInstanceFromAnyPage(page);
    await setupDatabaseOnSqlitePage(page, true);
    await initializeStorageForActiveInstance(page);

    // Switch back to the original instance and verify rematerialized assets
    // are still retrievable in app-specific views.
    await switchToInstanceFromAnyPage(page, 0);
    await setupDatabaseOnSqlitePage(page, true);

    await assertVfsExplorerShowsRematerializedItems(page);
    await assertPhotosAppShowsRematerializedPhoto(page);
    await assertAudioAppShowsRematerializedTrack(page);
  });
});
