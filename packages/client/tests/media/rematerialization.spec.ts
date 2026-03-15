import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  DB_OPERATION_TIMEOUT,
  createNewInstanceFromAnyPage,
  setupDatabaseOnSqlitePage,
  switchToInstanceByIdFromAnyPage
} from '../instanceSwitchingHelpers';
import { clearOriginStorage } from '../testUtils';

const REMATERIALIZED_PHOTO_NAME = 'Tearleads logo.svg';
const REMATERIALIZED_AUDIO_NAME = 'The Blessing.mp3';

const VFS_SERVICE_CONNECT_PATH = '/connect/tearleads.v2.VfsService';
const TEST_USER_ID = 'user-remat-test';

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function toMs(isoTimestamp: string): string {
  return String(Date.parse(isoTimestamp));
}

declare global {
  interface Window {
    __TEARLEADS_E2E__?: {
      rematerializeRemoteVfsStateIfNeeded: () => Promise<boolean>;
      getCurrentDatabaseInstanceId: () => string | null;
      getPersistedActiveInstanceId: () => Promise<string | null>;
      getVfsRegistryItemCount: () => Promise<number>;
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
        changeId: toBase64('change-root'),
        itemId: toBase64('root-item'),
        changeType: 'upsert',
        changedAtMs: toMs('2026-01-01T02:00:01.000Z'),
        objectType: 'folder',
        encryptedName: 'Root Item',
        ownerId: toBase64(TEST_USER_ID),
        createdAtMs: toMs('2026-01-01T02:00:00.000Z'),
        accessLevel: 'VFS_ACL_ACCESS_LEVEL_ADMIN'
      },
      {
        changeId: toBase64('change-album'),
        itemId: toBase64('album-item'),
        changeType: 'upsert',
        changedAtMs: toMs('2026-01-01T02:00:02.000Z'),
        objectType: 'album',
        encryptedName: 'Photos shared with Alice',
        ownerId: toBase64(TEST_USER_ID),
        createdAtMs: toMs('2026-01-01T02:00:02.000Z'),
        accessLevel: 'VFS_ACL_ACCESS_LEVEL_ADMIN'
      },
      {
        changeId: toBase64('change-photo'),
        itemId: toBase64('photo-item'),
        changeType: 'upsert',
        changedAtMs: toMs('2026-01-01T02:00:03.000Z'),
        objectType: 'photo',
        encryptedName: REMATERIALIZED_PHOTO_NAME,
        ownerId: toBase64(TEST_USER_ID),
        createdAtMs: toMs('2026-01-01T02:00:03.000Z'),
        accessLevel: 'VFS_ACL_ACCESS_LEVEL_ADMIN'
      },
      {
        changeId: toBase64('change-playlist'),
        itemId: toBase64('playlist-item'),
        changeType: 'upsert',
        changedAtMs: toMs('2026-01-01T02:00:04.000Z'),
        objectType: 'playlist',
        encryptedName: 'Music shared with Alice',
        ownerId: toBase64(TEST_USER_ID),
        createdAtMs: toMs('2026-01-01T02:00:04.000Z'),
        accessLevel: 'VFS_ACL_ACCESS_LEVEL_ADMIN'
      },
      {
        changeId: toBase64('change-audio'),
        itemId: toBase64('audio-item'),
        changeType: 'upsert',
        changedAtMs: toMs('2026-01-01T02:00:05.000Z'),
        objectType: 'audio',
        encryptedName: REMATERIALIZED_AUDIO_NAME,
        ownerId: toBase64(TEST_USER_ID),
        createdAtMs: toMs('2026-01-01T02:00:05.000Z'),
        accessLevel: 'VFS_ACL_ACCESS_LEVEL_ADMIN'
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
        opId: toBase64('op-photo-state'),
        itemId: toBase64('photo-item'),
        opType: 'VFS_CRDT_OP_TYPE_ITEM_UPSERT',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: toBase64(TEST_USER_ID),
        sourceTable: 'vfs_crdt_client_push',
        sourceId: toBase64('source-photo-state'),
        occurredAtMs: toMs('2026-01-01T02:00:03.100Z'),
        encryptedPayload: photoPayload,
        keyEpoch: 1
      },
      {
        opId: toBase64('op-root-album-link'),
        itemId: toBase64('album-item'),
        opType: 'VFS_CRDT_OP_TYPE_LINK_ADD',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: toBase64('root-item'),
        childId: toBase64('album-item'),
        actorId: toBase64(TEST_USER_ID),
        sourceTable: 'vfs_links',
        sourceId: toBase64('source-root-album-link'),
        occurredAtMs: toMs('2026-01-01T02:00:03.200Z')
      },
      {
        opId: toBase64('op-album-photo-link'),
        itemId: toBase64('photo-item'),
        opType: 'VFS_CRDT_OP_TYPE_LINK_ADD',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: toBase64('album-item'),
        childId: toBase64('photo-item'),
        actorId: toBase64(TEST_USER_ID),
        sourceTable: 'vfs_links',
        sourceId: toBase64('source-album-photo-link'),
        occurredAtMs: toMs('2026-01-01T02:00:03.300Z')
      },
      {
        opId: toBase64('op-audio-state'),
        itemId: toBase64('audio-item'),
        opType: 'VFS_CRDT_OP_TYPE_ITEM_UPSERT',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: toBase64(TEST_USER_ID),
        sourceTable: 'vfs_crdt_client_push',
        sourceId: toBase64('source-audio-state'),
        occurredAtMs: toMs('2026-01-01T02:00:05.100Z'),
        encryptedPayload: audioPayload,
        keyEpoch: 1
      },
      {
        opId: toBase64('op-root-playlist-link'),
        itemId: toBase64('playlist-item'),
        opType: 'VFS_CRDT_OP_TYPE_LINK_ADD',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: toBase64('root-item'),
        childId: toBase64('playlist-item'),
        actorId: toBase64(TEST_USER_ID),
        sourceTable: 'vfs_links',
        sourceId: toBase64('source-root-playlist-link'),
        occurredAtMs: toMs('2026-01-01T02:00:05.200Z')
      },
      {
        opId: toBase64('op-playlist-audio-link'),
        itemId: toBase64('audio-item'),
        opType: 'VFS_CRDT_OP_TYPE_LINK_ADD',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: toBase64('playlist-item'),
        childId: toBase64('audio-item'),
        actorId: toBase64(TEST_USER_ID),
        sourceTable: 'vfs_links',
        sourceId: toBase64('source-playlist-audio-link'),
        occurredAtMs: toMs('2026-01-01T02:00:05.300Z')
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

async function getCurrentDatabaseInstanceId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    return window.__TEARLEADS_E2E__?.getCurrentDatabaseInstanceId() ?? null;
  });
}

async function waitForActiveInstanceVfsRegistryItems(
  page: Page,
  instanceId: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        return page.evaluate(async () => {
          const helpers = window.__TEARLEADS_E2E__;
          if (!helpers) {
            throw new Error('E2E rematerialization helper is unavailable');
          }

          return {
            currentInstanceId: helpers.getCurrentDatabaseInstanceId(),
            persistedActiveInstanceId:
              await helpers.getPersistedActiveInstanceId(),
            itemCount: await helpers.getVfsRegistryItemCount()
          };
        });
      },
      {
        timeout: DB_OPERATION_TIMEOUT
      }
    )
    .toEqual({
      currentInstanceId: instanceId,
      persistedActiveInstanceId: instanceId,
      itemCount: 6
    });
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
    const originalInstanceId = await getCurrentDatabaseInstanceId(page);
    if (!originalInstanceId) {
      throw new Error('Expected original database instance id');
    }

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
    await switchToInstanceByIdFromAnyPage(page, originalInstanceId);
    await setupDatabaseOnSqlitePage(page, true);
    await waitForActiveInstanceVfsRegistryItems(page, originalInstanceId);

    await assertVfsExplorerShowsRematerializedItems(page);
    await assertPhotosAppShowsRematerializedPhoto(page);
    await assertAudioAppShowsRematerializedTrack(page);
  });
});
