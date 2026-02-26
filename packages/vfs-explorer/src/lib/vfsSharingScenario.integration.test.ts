import { withRealDatabase } from '@tearleads/db-test-utils';
import { describe, expect, it } from 'vitest';
import {
  ALICE_EMAIL,
  ALICE_ID,
  BOB_EMAIL,
  BOB_ID,
  CAROL_EMAIL,
  CAROL_ID,
  insertAcl,
  insertFolder,
  insertUser,
  seedBobAliceShare,
  vfsAclEnabledMigrations
} from '../test/vfsAclTestMigrations';
import { querySharedByMe, querySharedWithMe } from './vfsSharesQuery';

const DEFAULT_SORT = { column: null, direction: null } as const;

describe('vfsSharingScenario integration (Bob & Alice)', () => {
  it('Bob shares a folder with Alice → Bob sees it in querySharedByMe', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        await seedBobAliceShare(adapter);

        const rows = await querySharedByMe(db, BOB_ID, DEFAULT_SORT);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.shareId).toBe('bob-to-alice');
        expect(rows[0]?.name).toBe('Shared Project');
        expect(rows[0]?.targetId).toBe(ALICE_ID);
        expect(rows[0]?.permissionLevel).toBe('view');
        expect(rows[0]?.objectType).toBe('folder');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('Same data → Alice sees it in querySharedWithMe with Bob email resolved', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        await seedBobAliceShare(adapter);

        const rows = await querySharedWithMe(db, ALICE_ID, DEFAULT_SORT);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.shareId).toBe('bob-to-alice');
        expect(rows[0]?.name).toBe('Shared Project');
        expect(rows[0]?.sharedById).toBe(BOB_ID);
        expect(rows[0]?.sharedByEmail).toBe(BOB_EMAIL);
        expect(rows[0]?.permissionLevel).toBe('view');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('Bob shares multiple items → all appear in querySharedByMe', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        await insertUser(adapter, BOB_ID, BOB_EMAIL);

        for (const [i, name] of ['Alpha', 'Beta', 'Gamma'].entries()) {
          const id = crypto.randomUUID();
          await insertFolder(adapter, id, name, BOB_ID, now + i);
          await insertAcl(adapter, {
            id: `share:bob-share-${name.toLowerCase()}`,
            itemId: id,
            principalType: 'user',
            principalId: ALICE_ID,
            accessLevel: 'read',
            grantedBy: BOB_ID,
            createdAt: now + i
          });
        }

        const rows = await querySharedByMe(db, BOB_ID, DEFAULT_SORT);
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.name)).toContain('Alpha');
        expect(rows.map((r) => r.name)).toContain('Beta');
        expect(rows.map((r) => r.name)).toContain('Gamma');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('Alice receives shares from Bob and Carol → both appear in querySharedWithMe', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        const bobFolder = crypto.randomUUID();
        const carolFolder = crypto.randomUUID();

        await insertUser(adapter, BOB_ID, BOB_EMAIL);
        await insertUser(adapter, ALICE_ID, ALICE_EMAIL);
        await insertUser(adapter, CAROL_ID, CAROL_EMAIL);
        await insertFolder(adapter, bobFolder, 'Bob Folder', BOB_ID, now);
        await insertFolder(
          adapter,
          carolFolder,
          'Carol Folder',
          CAROL_ID,
          now + 1
        );

        await insertAcl(adapter, {
          id: 'share:bob-to-alice-multi',
          itemId: bobFolder,
          principalType: 'user',
          principalId: ALICE_ID,
          accessLevel: 'write',
          grantedBy: BOB_ID,
          createdAt: now
        });
        await insertAcl(adapter, {
          id: 'share:carol-to-alice',
          itemId: carolFolder,
          principalType: 'user',
          principalId: ALICE_ID,
          accessLevel: 'read',
          grantedBy: CAROL_ID,
          createdAt: now + 1
        });

        const rows = await querySharedWithMe(db, ALICE_ID, DEFAULT_SORT);
        expect(rows).toHaveLength(2);
        const emails = rows.map((r) => r.sharedByEmail);
        expect(emails).toContain(BOB_EMAIL);
        expect(emails).toContain(CAROL_EMAIL);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('revoked share excluded from both queries', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        const folderId = crypto.randomUUID();

        await insertUser(adapter, BOB_ID, BOB_EMAIL);
        await insertFolder(adapter, folderId, 'Revoked Folder', BOB_ID, now);
        await insertAcl(adapter, {
          id: 'share:revoked-share',
          itemId: folderId,
          principalType: 'user',
          principalId: ALICE_ID,
          accessLevel: 'read',
          grantedBy: BOB_ID,
          createdAt: now,
          revokedAt: now + 1000
        });

        expect(await querySharedByMe(db, BOB_ID, DEFAULT_SORT)).toHaveLength(0);
        expect(
          await querySharedWithMe(db, ALICE_ID, DEFAULT_SORT)
        ).toHaveLength(0);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('org-share ACL entries excluded from both queries', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        const folderId = crypto.randomUUID();

        await insertUser(adapter, BOB_ID, BOB_EMAIL);
        await insertFolder(adapter, folderId, 'Org Folder', BOB_ID, now);
        await insertAcl(adapter, {
          id: 'org-share:some-org:entry1',
          itemId: folderId,
          principalType: 'organization',
          principalId: ALICE_ID,
          accessLevel: 'read',
          grantedBy: BOB_ID,
          createdAt: now
        });

        expect(await querySharedByMe(db, BOB_ID, DEFAULT_SORT)).toHaveLength(0);
        expect(
          await querySharedWithMe(db, ALICE_ID, DEFAULT_SORT)
        ).toHaveLength(0);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('group principal_type excluded from querySharedWithMe', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        const folderId = crypto.randomUUID();

        await insertUser(adapter, BOB_ID, BOB_EMAIL);
        await insertFolder(adapter, folderId, 'Group Folder', BOB_ID, now);
        await insertAcl(adapter, {
          id: 'share:group-share',
          itemId: folderId,
          principalType: 'group',
          principalId: ALICE_ID,
          accessLevel: 'read',
          grantedBy: BOB_ID,
          createdAt: now
        });

        expect(
          await querySharedWithMe(db, ALICE_ID, DEFAULT_SORT)
        ).toHaveLength(0);
        expect(await querySharedByMe(db, BOB_ID, DEFAULT_SORT)).toHaveLength(1);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('permission level mapping: read→view, write→edit, admin→edit', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        await insertUser(adapter, BOB_ID, BOB_EMAIL);

        for (const [i, level] of ['read', 'write', 'admin'].entries()) {
          const folderId = crypto.randomUUID();
          await insertFolder(
            adapter,
            folderId,
            `Folder-${level}`,
            BOB_ID,
            now + i
          );
          await insertAcl(adapter, {
            id: `share:perm-${level}`,
            itemId: folderId,
            principalType: 'user',
            principalId: ALICE_ID,
            accessLevel: level,
            grantedBy: BOB_ID,
            createdAt: now + i
          });
        }

        const rows = await querySharedByMe(db, BOB_ID, DEFAULT_SORT);
        expect(rows).toHaveLength(3);
        const permByName = new Map(
          rows.map((r) => [r.name, r.permissionLevel])
        );
        expect(permByName.get('Folder-read')).toBe('view');
        expect(permByName.get('Folder-write')).toBe('edit');
        expect(permByName.get('Folder-admin')).toBe('edit');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('shares granted by other users not in Bob querySharedByMe', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        const folderId = crypto.randomUUID();

        await insertUser(adapter, BOB_ID, BOB_EMAIL);
        await insertUser(adapter, CAROL_ID, CAROL_EMAIL);
        await insertFolder(adapter, folderId, 'Carol Item', CAROL_ID, now);
        await insertAcl(adapter, {
          id: 'share:carol-to-alice-not-bob',
          itemId: folderId,
          principalType: 'user',
          principalId: ALICE_ID,
          accessLevel: 'read',
          grantedBy: CAROL_ID,
          createdAt: now
        });

        expect(await querySharedByMe(db, BOB_ID, DEFAULT_SORT)).toHaveLength(0);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('expires_at preserved in results', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        const expiresAt = now + 86400000;
        const folderId = crypto.randomUUID();

        await insertUser(adapter, BOB_ID, BOB_EMAIL);
        await insertFolder(adapter, folderId, 'Expiring Folder', BOB_ID, now);
        await insertAcl(adapter, {
          id: 'share:expiring',
          itemId: folderId,
          principalType: 'user',
          principalId: ALICE_ID,
          accessLevel: 'read',
          grantedBy: BOB_ID,
          createdAt: now,
          expiresAt
        });

        const byMe = await querySharedByMe(db, BOB_ID, DEFAULT_SORT);
        expect(byMe).toHaveLength(1);
        expect(byMe[0]?.expiresAt).toBeInstanceOf(Date);
        expect(byMe[0]?.expiresAt?.getTime()).toBe(expiresAt);

        const withMe = await querySharedWithMe(db, ALICE_ID, DEFAULT_SORT);
        expect(withMe).toHaveLength(1);
        expect(withMe[0]?.expiresAt).toBeInstanceOf(Date);
        expect(withMe[0]?.expiresAt?.getTime()).toBe(expiresAt);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('default sort orders by name alphabetically', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        await insertUser(adapter, BOB_ID, BOB_EMAIL);

        for (const [i, name] of ['Zebra', 'Apple', 'Mango'].entries()) {
          const folderId = crypto.randomUUID();
          await insertFolder(adapter, folderId, name, BOB_ID, now + i);
          await insertAcl(adapter, {
            id: `share:sort-${name.toLowerCase()}`,
            itemId: folderId,
            principalType: 'user',
            principalId: ALICE_ID,
            accessLevel: 'read',
            grantedBy: BOB_ID,
            createdAt: now + i
          });
        }

        const rows = await querySharedByMe(db, BOB_ID, DEFAULT_SORT);
        expect(rows.map((r) => r.name)).toEqual(['Apple', 'Mango', 'Zebra']);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });
});
