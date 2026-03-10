import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import { wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installApiV2WasmBindingsOverride } from './test/apiV2WasmBindingsTestOverride';
import { getSharedTestContext } from './test/testContext';

const mockLogApiEvent = vi.fn();
const authState = {
  token: '',
  refreshToken: null as string | null
};

vi.mock('./authStorage', () => ({
  getAuthHeaderValue: () =>
    authState.token.length > 0 ? `Bearer ${authState.token}` : null,
  getStoredAuthToken: () =>
    authState.token.length > 0 ? authState.token : null,
  getStoredRefreshToken: () => authState.refreshToken,
  updateStoredTokens: (accessToken: string, refreshToken: string) => {
    authState.token = accessToken;
    authState.refreshToken = refreshToken;
  },
  clearStoredAuth: () => {
    authState.token = '';
    authState.refreshToken = null;
  },
  releaseRefreshLock: () => undefined,
  setSessionExpiredError: () => undefined,
  tryAcquireRefreshLock: () => true,
  waitForRefreshCompletion: async () => false
}));

const toBase64 = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64');

const utf8Bytes = (value: string): Uint8Array =>
  new TextEncoder().encode(value);

async function sha256Base64(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  let binary = '';
  const bytes = new Uint8Array(digest);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

describe('api with msw (MLS binary routes)', () => {
  let seededUser: SeededUser;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    installApiV2WasmBindingsOverride();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    vi.stubEnv('VFS_CRDT_ENVELOPE_BYTEA_WRITES', 'true');
    localStorage.clear();

    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    authState.token = seededUser.accessToken;
    authState.refreshToken = null;
    mockLogApiEvent.mockResolvedValue(undefined);

    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger((...args: Parameters<typeof mockLogApiEvent>) =>
      mockLogApiEvent(...args)
    );

    const { setApiRequestHeadersProvider } = await import('./apiCore');
    setApiRequestHeadersProvider(() => ({
      'X-Organization-Id': seededUser.organizationId
    }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    authState.token = '';
    authState.refreshToken = null;
    const { resetApiEventLogger } = await import('./apiLogger');
    const { resetApiRequestHeadersProvider } = await import('./apiCore');
    resetApiEventLogger();
    resetApiRequestHeadersProvider();
  });

  it('routes binary MLS payloads through msw with byte round trips', async () => {
    const ctx = getSharedTestContext();
    const secondUser = await seedTestUser(ctx);

    await ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [secondUser.userId, seededUser.organizationId]
    );

    await ctx.pool.query(
      `INSERT INTO mls_key_packages (id, user_id, key_package_data, key_package_ref, cipher_suite, created_at)
       VALUES ('kp-add', $1, $2, 'kp-ref-add', 3, NOW()),
              ('kp-extra', $1, $3, 'kp-ref-extra', 3, NOW())`,
      [secondUser.userId, toBase64('kp-data-add'), toBase64('kp-data-extra')]
    );

    const { createMlsV2Routes } = await import('./mlsRoutesEntry');
    const routes = createMlsV2Routes();

    const createGroupResponse = await routes.createGroup({
      name: 'MLS Binary Group',
      groupIdMls: 'group-id-mls',
      cipherSuite: 3
    });
    const groupId = createGroupResponse.group.id;
    const addMemberEpoch = createGroupResponse.group.currentEpoch + 1;
    const removeMemberEpoch = addMemberEpoch + 1;

    await routes.getGroup(groupId);
    await routes.getGroupMembers(groupId);

    await routes.addGroupMember(groupId, {
      userId: secondUser.userId,
      commit: utf8Bytes('commit-bytes'),
      welcome: utf8Bytes('welcome-bytes'),
      keyPackageRef: 'kp-ref-add',
      newEpoch: addMemberEpoch
    });

    const userKeyPackages = await routes.getUserKeyPackages(secondUser.userId);
    expect(userKeyPackages.keyPackages[0]?.keyPackageData).toBeInstanceOf(
      Uint8Array
    );

    const messageCiphertext = utf8Bytes('ciphertext');
    const sent = await routes.sendGroupMessage(groupId, {
      ciphertext: messageCiphertext,
      epoch: addMemberEpoch,
      messageType: 'application'
    });
    expect(Array.from(sent.message.ciphertext)).toEqual(
      Array.from(messageCiphertext)
    );

    const messages = await routes.getGroupMessages(groupId, { limit: 25 });
    expect(messages.messages[0]?.ciphertext).toBeInstanceOf(Uint8Array);
    expect(Array.from(messages.messages[0]?.ciphertext ?? [])).toEqual(
      Array.from(messageCiphertext)
    );

    const stateBytes = utf8Bytes('encrypted-state');
    const stateHash = await sha256Base64(stateBytes);
    await routes.uploadGroupState(groupId, {
      epoch: addMemberEpoch,
      encryptedState: stateBytes,
      stateHash
    });
    const state = await routes.getGroupState(groupId);
    expect(state.state?.encryptedState).toBeInstanceOf(Uint8Array);
    expect(Array.from(state.state?.encryptedState ?? [])).toEqual(
      Array.from(stateBytes)
    );

    const uploadResponse = await routes.uploadKeyPackages({
      keyPackages: [
        {
          keyPackageData: utf8Bytes('kp-data-seed'),
          keyPackageRef: 'kp-ref-seed',
          cipherSuite: 3
        }
      ]
    });
    const uploadedKeyPackageId = uploadResponse.keyPackages[0]?.id ?? '';

    const myKeyPackages = await routes.getMyKeyPackages();
    expect(myKeyPackages.keyPackages[0]?.keyPackageData).toBeInstanceOf(
      Uint8Array
    );

    const welcomeId = 'welcome-binary-ack';
    await ctx.pool.query(
      `INSERT INTO mls_welcome_messages (id, group_id, recipient_user_id, key_package_ref, welcome_data, epoch, created_at)
       VALUES ($1, $2, $3, 'kp-ref-ack', $4, $5, NOW())`,
      [
        welcomeId,
        groupId,
        seededUser.userId,
        toBase64('welcome-data'),
        addMemberEpoch
      ]
    );
    const welcomes = await routes.getWelcomeMessages();
    const welcome = welcomes.welcomes.find((item) => item.id === welcomeId);
    expect(welcome?.welcome).toBeInstanceOf(Uint8Array);
    expect(Array.from(welcome?.welcome ?? [])).toEqual(
      Array.from(utf8Bytes('welcome-data'))
    );
    await routes.acknowledgeWelcome(welcomeId, { groupId });

    await routes.removeGroupMember(groupId, secondUser.userId, {
      commit: utf8Bytes('remove-commit'),
      newEpoch: removeMemberEpoch
    });
    await routes.leaveGroup(groupId);
    await routes.deleteKeyPackage(uploadedKeyPackageId);

    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.MlsService/AddGroupMember'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.MlsService/RemoveGroupMember'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.MlsService/SendGroupMessage'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.MlsService/UploadGroupState'
      )
    ).toBe(true);
  });
});
