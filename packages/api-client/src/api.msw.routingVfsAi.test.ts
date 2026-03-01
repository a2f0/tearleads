import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import { getRecordedApiRequests, wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY } from './authStorage';
import { getSharedTestContext } from './test/testContext';

const mockLogApiEvent = vi.fn();

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

type RecordedApiRequest = ReturnType<typeof getRecordedApiRequests>[number];

const getRequestsFor = (
  method: string,
  pathname: string
): RecordedApiRequest[] =>
  getRecordedApiRequests().filter(
    (request) =>
      request.method === method.toUpperCase() && request.pathname === pathname
  );

const getRequestQuery = (request: RecordedApiRequest): Record<string, string> =>
  Object.fromEntries(new URL(request.url).searchParams.entries());

const expectSingleRequestQuery = (
  method: string,
  pathname: string,
  expectedQuery: Record<string, string>
): void => {
  const requests = getRequestsFor(method, pathname);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (!request) {
    throw new Error(`Missing recorded request: ${method} ${pathname}`);
  }
  expect(getRequestQuery(request)).toEqual(expectedQuery);
};

let seededUser: SeededUser;

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    localStorage.setItem(AUTH_TOKEN_KEY, seededUser.accessToken);
    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger((...args: Parameters<typeof mockLogApiEvent>) =>
      mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
  });

  it('routes vfs requests through msw', async () => {
    const ctx = getSharedTestContext();

    // Create second user in a shared org for share operations
    const secondUser = await seedTestUser(ctx);
    const sharedOrgId = 'shared-org-vfs';
    await ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Shared Org', NOW(), NOW())`,
      [sharedOrgId]
    );
    await ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW()), ($3, $2, NOW())`,
      [seededUser.userId, sharedOrgId, secondUser.userId]
    );

    // Create target org for org-share operations
    const targetOrgId = 'target-org-vfs';
    await ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Target Org', NOW(), NOW())`,
      [targetOrgId]
    );

    const api = await loadApi();

    // Setup keys first (real API returns 404 if keys don't exist)
    await api.vfs.setupKeys({
      publicEncryptionKey: 'public-encryption-key',
      publicSigningKey: 'public-signing-key',
      encryptedPrivateKeys: 'encrypted-private-keys',
      argon2Salt: 'argon2-salt'
    });
    await api.vfs.getMyKeys();

    // Register VFS item
    await api.vfs.register({
      id: 'item-1',
      objectType: 'folder',
      encryptedSessionKey: 'encrypted-session-key'
    });

    // Share operations using real item and user IDs
    await api.vfs.getShares('item-1');
    const shareResponse = await api.vfs.createShare({
      itemId: 'item-1',
      shareType: 'user',
      targetId: secondUser.userId,
      permissionLevel: 'view',
      wrappedKey: {
        recipientUserId: secondUser.userId,
        recipientPublicKeyId: 'pk-user-2',
        keyEpoch: 2,
        encryptedKey: 'wrapped-key',
        senderSignature: 'sender-signature'
      }
    });
    const shareUuid = shareResponse.id.replace('share:', '');

    // Org share operations
    const orgShareResponse = await api.vfs.createOrgShare({
      itemId: 'item-1',
      sourceOrgId: sharedOrgId,
      targetOrgId: targetOrgId,
      permissionLevel: 'view'
    });
    const orgShareParts = orgShareResponse.id.split(':');
    const orgShareUuid = orgShareParts[orgShareParts.length - 1];
    expect(orgShareUuid).toBeTruthy();

    // Rekey while share is still active
    await api.vfs.rekeyItem('item-1', {
      reason: 'manual',
      newEpoch: 2,
      wrappedKeys: [
        {
          recipientUserId: secondUser.userId,
          recipientPublicKeyId: 'pk-user-2',
          keyEpoch: 2,
          encryptedKey: 'rekeyed-key',
          senderSignature: 'rekey-signature'
        }
      ]
    });

    // Update and delete shares
    await api.vfs.updateShare(shareUuid, { permissionLevel: 'edit' });
    await api.vfs.deleteShare(shareUuid);
    await api.vfs.deleteOrgShare(orgShareUuid ?? '');

    // Search share targets
    await api.vfs.searchShareTargets('test query', 'user');
    await api.vfs.getSharePolicyPreview({
      rootItemId: 'item-1',
      principalType: 'user',
      principalId: secondUser.userId,
      limit: 25,
      maxDepth: 2,
      q: 'wallet',
      objectType: ['contact', 'walletItem']
    });

    expect(wasApiRequestMade('POST', '/vfs/keys')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/keys/me')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/items/item-1/shares')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item-1/shares')).toBe(true);
    expect(wasApiRequestMade('PATCH', `/vfs/shares/${shareUuid}`)).toBe(true);
    expect(wasApiRequestMade('DELETE', `/vfs/shares/${shareUuid}`)).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item-1/org-shares')).toBe(
      true
    );
    expect(wasApiRequestMade('DELETE', `/vfs/org-shares/${orgShareUuid}`)).toBe(
      true
    );
    expect(wasApiRequestMade('POST', '/vfs/items/item-1/rekey')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/share-targets/search')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/share-policies/preview')).toBe(true);

    expectSingleRequestQuery('GET', '/vfs/share-targets/search', {
      q: 'test query',
      type: 'user'
    });
    expectSingleRequestQuery('GET', '/vfs/share-policies/preview', {
      rootItemId: 'item-1',
      principalType: 'user',
      principalId: secondUser.userId,
      limit: '25',
      maxDepth: '2',
      q: 'wallet',
      objectType: 'contact,walletItem'
    });
  });

  it('registers an item through onboarding helper using vfs routes', async () => {
    const { registerVfsItemWithApiOnboarding } = await import(
      './vfsCrypto/registrationClient'
    );

    const sessionKey = new Uint8Array(32);
    sessionKey.fill(7);
    const result = await registerVfsItemWithApiOnboarding({
      password: 'test-password',
      id: 'item-onboard-1',
      objectType: 'file',
      sessionKey
    });

    expect(result.sessionKey).toEqual(sessionKey);
    expect(result.registerResponse.id).toBe('item-onboard-1');
    expect(wasApiRequestMade('GET', '/vfs/keys/me')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/register')).toBe(true);
  });

  it('routes ai usage requests through msw', async () => {
    const api = await loadApi();

    await api.ai.recordUsage({
      modelId: 'mistralai/mistral-7b-instruct',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 10
    });
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    expect(wasApiRequestMade('POST', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage/summary')).toBe(true);

    expectSingleRequestQuery('GET', '/ai/usage', {
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: '10'
    });
  });

  it('routes mls requests through msw', async () => {
    const ctx = getSharedTestContext();

    // Create second user and add to seeded user's org for MLS membership
    const secondUser = await seedTestUser(ctx);
    await ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [secondUser.userId, seededUser.organizationId]
    );

    // Insert key packages for secondUser (one for addMember, one for getUserKeyPackages)
    await ctx.pool.query(
      `INSERT INTO mls_key_packages (id, user_id, key_package_data, key_package_ref, cipher_suite, created_at)
       VALUES ('kp-add', $1, 'kp-data-add', 'kp-ref-add', 3, NOW()),
              ('kp-extra', $1, 'kp-data-extra', 'kp-ref-extra', 3, NOW())`,
      [secondUser.userId]
    );

    const api = await loadApi();

    // Group lifecycle
    await api.mls.listGroups();
    const createGroupResponse = await api.mls.createGroup({
      name: 'MLS Group',
      groupIdMls: 'group-id-mls',
      cipherSuite: 3
    });
    const groupId = createGroupResponse.group.id;
    const addMemberEpoch = createGroupResponse.group.currentEpoch + 1;
    const removeMemberEpoch = addMemberEpoch + 1;

    await api.mls.getGroup(groupId);
    await api.mls.updateGroup(groupId, { name: 'MLS Group Updated' });
    await api.mls.getGroupMembers(groupId);

    // Member operations
    await api.mls.addGroupMember(groupId, {
      userId: secondUser.userId,
      commit: 'commit-bytes',
      welcome: 'welcome-bytes',
      keyPackageRef: 'kp-ref-add',
      newEpoch: addMemberEpoch
    });

    // Get second user's remaining key packages (kp-ref-extra still unconsumed)
    await api.mls.getUserKeyPackages(secondUser.userId);

    // Messages
    await api.mls.getGroupMessages(groupId, { cursor: '10', limit: 25 });
    await api.mls.sendGroupMessage(groupId, {
      ciphertext: 'ciphertext',
      epoch: addMemberEpoch,
      messageType: 'application'
    });

    // State
    await api.mls.getGroupState(groupId);
    await api.mls.uploadGroupState(groupId, {
      epoch: addMemberEpoch,
      encryptedState: 'encrypted-state',
      stateHash: 'state-hash'
    });

    // Key packages
    await api.mls.getMyKeyPackages();
    const uploadResponse = await api.mls.uploadKeyPackages({
      keyPackages: [
        {
          keyPackageData: 'kp-data-seed',
          keyPackageRef: 'kp-ref-seed',
          cipherSuite: 3
        }
      ]
    });
    const uploadedKp = uploadResponse.keyPackages[0];
    expect(uploadedKp).toBeTruthy();
    const uploadedKeyPackageId = uploadedKp?.id;

    // Welcome messages
    await api.mls.getWelcomeMessages();

    // Insert a welcome message for seededUser so we can acknowledge it
    const welcomeId = 'welcome-for-ack';
    await ctx.pool.query(
      `INSERT INTO mls_welcome_messages (id, group_id, recipient_user_id, key_package_ref, welcome_data, epoch, created_at)
       VALUES ($1, $2, $3, 'kp-ref-ack', 'welcome-data', $4, NOW())`,
      [welcomeId, groupId, seededUser.userId, addMemberEpoch]
    );
    await api.mls.acknowledgeWelcome(welcomeId, { groupId });

    // Remove member, leave group, delete key package
    await api.mls.removeGroupMember(groupId, secondUser.userId, {
      commit: 'remove-commit',
      newEpoch: removeMemberEpoch
    });
    await api.mls.leaveGroup(groupId);
    await api.mls.deleteKeyPackage(uploadedKeyPackageId ?? '');

    expect(wasApiRequestMade('GET', '/mls/groups')).toBe(true);
    expect(wasApiRequestMade('GET', `/mls/groups/${groupId}`)).toBe(true);
    expect(wasApiRequestMade('POST', '/mls/groups')).toBe(true);
    expect(wasApiRequestMade('PATCH', `/mls/groups/${groupId}`)).toBe(true);
    expect(wasApiRequestMade('GET', `/mls/groups/${groupId}/members`)).toBe(
      true
    );
    expect(wasApiRequestMade('POST', `/mls/groups/${groupId}/members`)).toBe(
      true
    );
    expect(wasApiRequestMade('GET', `/vfs/mls/groups/${groupId}/messages`)).toBe(
      true
    );
    expect(wasApiRequestMade('POST', `/vfs/mls/groups/${groupId}/messages`)).toBe(
      true
    );
    expect(wasApiRequestMade('GET', `/mls/groups/${groupId}/state`)).toBe(true);
    expect(wasApiRequestMade('POST', `/mls/groups/${groupId}/state`)).toBe(
      true
    );
    expect(wasApiRequestMade('GET', '/mls/key-packages/me')).toBe(true);
    expect(
      wasApiRequestMade('GET', `/mls/key-packages/${secondUser.userId}`)
    ).toBe(true);
    expect(wasApiRequestMade('POST', '/mls/key-packages')).toBe(true);
    expect(wasApiRequestMade('GET', '/mls/welcome-messages')).toBe(true);
    expect(
      wasApiRequestMade('POST', `/mls/welcome-messages/${welcomeId}/ack`)
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'DELETE',
        `/mls/groups/${groupId}/members/${secondUser.userId}`
      )
    ).toBe(true);
    expect(wasApiRequestMade('DELETE', `/mls/groups/${groupId}`)).toBe(true);
    expect(
      wasApiRequestMade('DELETE', `/mls/key-packages/${uploadedKeyPackageId}`)
    ).toBe(true);

    expectSingleRequestQuery('GET', `/vfs/mls/groups/${groupId}/messages`, {
      cursor: '10',
      limit: '25'
    });
  });

  it('builds query-string variants through msw request metadata', async () => {
    const api = await loadApi();

    await api.admin.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'email',
      sortDirection: 'desc'
    });
    await api.admin.postgres.getRows('public', 'users');

    // Redis getKeys: with params vs without
    await api.admin.redis.getKeys('5', 10);
    await api.admin.redis.getKeys();

    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 25
    });
    await api.ai.getUsage();
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });
    await api.ai.getUsageSummary();

    const postgresRowsRequests = getRequestsFor(
      'GET',
      '/admin/postgres/tables/public/users/rows'
    );
    expect(postgresRowsRequests).toHaveLength(2);
    expect(postgresRowsRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          limit: '10',
          offset: '20',
          sortColumn: 'email',
          sortDirection: 'desc'
        },
        {}
      ])
    );

    const aiUsageRequests = getRequestsFor('GET', '/ai/usage');
    expect(aiUsageRequests).toHaveLength(2);
    expect(aiUsageRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          cursor: '2025-01-01T00:00:00.000Z',
          limit: '25'
        },
        {}
      ])
    );

    const aiUsageSummaryRequests = getRequestsFor('GET', '/ai/usage/summary');
    expect(aiUsageSummaryRequests).toHaveLength(2);
    expect(aiUsageSummaryRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31'
        },
        {}
      ])
    );

    const redisKeysRequests = getRequestsFor('GET', '/admin/redis/keys');
    expect(redisKeysRequests).toHaveLength(2);
    expect(redisKeysRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([{ cursor: '5', limit: '10' }, {}])
    );
  });
});
