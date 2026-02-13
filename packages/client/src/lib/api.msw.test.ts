import {
  getRecordedApiRequests,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

describe('api with msw', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes auth requests through msw', async () => {
    const api = await loadApi();

    const loginResponse = await api.auth.login('user@example.com', 'password');
    const registerResponse = await api.auth.register(
      'new@example.com',
      'password'
    );
    const sessionsResponse = await api.auth.getSessions();
    const deleteResponse = await api.auth.deleteSession('session 1');
    const logoutResponse = await api.auth.logout();

    expect(loginResponse.accessToken).toBe('test-access-token');
    expect(registerResponse.refreshToken).toBe('test-refresh-token');
    expect(sessionsResponse.sessions).toHaveLength(1);
    expect(deleteResponse.deleted).toBe(true);
    expect(logoutResponse.loggedOut).toBe(true);

    expect(wasApiRequestMade('POST', '/auth/login')).toBe(true);
    expect(wasApiRequestMade('POST', '/auth/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/auth/sessions')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/auth/sessions/session%201')).toBe(true);
    expect(wasApiRequestMade('POST', '/auth/logout')).toBe(true);
  });

  it('routes admin requests through msw and preserves query/encoding', async () => {
    const api = await loadApi();

    await api.ping.get();
    await api.admin.getContext();

    await api.admin.postgres.getInfo();
    await api.admin.postgres.getTables();
    await api.admin.postgres.getColumns('public', 'users');
    await api.admin.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'id',
      sortDirection: 'desc'
    });

    await api.admin.redis.getKeys('5', 2);
    await api.admin.redis.getValue('user:1');
    await api.admin.redis.deleteKey('user:1');
    await api.admin.redis.getDbSize();

    await api.admin.groups.list({ organizationId: 'org-1' });
    await api.admin.groups.get('group 1');
    await api.admin.groups.create({ name: 'Team', organizationId: 'org-1' });
    await api.admin.groups.update('group 1', { name: 'Team Updated' });
    await api.admin.groups.delete('group 1');
    await api.admin.groups.getMembers('group 1');
    await api.admin.groups.addMember('group 1', 'user 2');
    await api.admin.groups.removeMember('group 1', 'user 2');

    await api.admin.organizations.list({ organizationId: 'org-1' });
    await api.admin.organizations.get('org 1');
    await api.admin.organizations.getUsers('org 1');
    await api.admin.organizations.getGroups('org 1');
    await api.admin.organizations.create({ name: 'Org Created' });
    await api.admin.organizations.update('org 1', {
      description: 'Updated Description'
    });
    await api.admin.organizations.delete('org 1');

    await api.admin.users.list({ organizationId: 'org-1' });
    await api.admin.users.get('user-2');
    await api.admin.users.update('user-2', {
      emailConfirmed: true,
      admin: false
    });

    expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/context')).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/postgres/info')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/postgres/tables')).toBe(true);
    expect(
      wasApiRequestMade('GET', '/admin/postgres/tables/public/users/columns')
    ).toBe(true);
    expect(
      wasApiRequestMade('GET', '/admin/postgres/tables/public/users/rows')
    ).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/redis/keys')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/redis/keys/user%3A1')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/admin/redis/keys/user%3A1')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/redis/dbsize')).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/groups')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/groups/group%201')).toBe(true);
    expect(wasApiRequestMade('POST', '/admin/groups')).toBe(true);
    expect(wasApiRequestMade('PUT', '/admin/groups/group%201')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/admin/groups/group%201')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/groups/group%201/members')).toBe(true);
    expect(wasApiRequestMade('POST', '/admin/groups/group%201/members')).toBe(true);
    expect(
      wasApiRequestMade('DELETE', '/admin/groups/group%201/members/user%202')
    ).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/organizations')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/organizations/org%201')).toBe(true);
    expect(
      wasApiRequestMade('GET', '/admin/organizations/org%201/users')
    ).toBe(true);
    expect(
      wasApiRequestMade('GET', '/admin/organizations/org%201/groups')
    ).toBe(true);
    expect(wasApiRequestMade('POST', '/admin/organizations')).toBe(true);
    expect(wasApiRequestMade('PUT', '/admin/organizations/org%201')).toBe(true);
    expect(
      wasApiRequestMade('DELETE', '/admin/organizations/org%201')
    ).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/users')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/users/user-2')).toBe(true);
    expect(wasApiRequestMade('PATCH', '/admin/users/user-2')).toBe(true);

    const recordedRequests = getRecordedApiRequests();
    expect(
      recordedRequests.some(
        (request) =>
          request.pathname === '/admin/redis/keys' &&
          request.url.includes('cursor=5') &&
          request.url.includes('limit=2')
      )
    ).toBe(true);
    expect(
      recordedRequests.some(
        (request) =>
          request.pathname === '/admin/postgres/tables/public/users/rows' &&
          request.url.includes('limit=10') &&
          request.url.includes('offset=20') &&
          request.url.includes('sortColumn=id') &&
          request.url.includes('sortDirection=desc')
      )
    ).toBe(true);
  });

  it('routes vfs and ai requests through msw', async () => {
    const api = await loadApi();

    await api.vfs.getMyKeys();
    await api.vfs.setupKeys({
      publicEncryptionKey: 'public-encryption-key',
      encryptedPrivateKeys: 'encrypted-private-keys',
      argon2Salt: 'argon2-salt'
    });
    await api.vfs.register({
      id: 'item-1',
      objectType: 'file',
      encryptedSessionKey: 'encrypted-session-key'
    });
    await api.vfs.getShares('item 1');
    await api.vfs.createShare({
      itemId: 'item 1',
      shareType: 'user',
      targetId: 'user-2',
      permissionLevel: 'view'
    });
    await api.vfs.updateShare('share 1', { permissionLevel: 'edit' });
    await api.vfs.deleteShare('share 1');
    await api.vfs.createOrgShare({
      itemId: 'item 1',
      sourceOrgId: 'org-1',
      targetOrgId: 'org-2',
      permissionLevel: 'view'
    });
    await api.vfs.deleteOrgShare('org share 1');
    await api.vfs.searchShareTargets('test query', 'user');

    await api.ai.createConversation({
      encryptedTitle: 'encrypted-title',
      encryptedSessionKey: 'encrypted-session-key'
    });
    await api.ai.listConversations({ cursor: 'cursor-1', limit: 5 });
    await api.ai.getConversation('conversation 1');
    await api.ai.updateConversation('conversation 1', {
      encryptedTitle: 'encrypted-title-2'
    });
    await expect(
      api.ai.deleteConversation('conversation 1')
    ).resolves.toBeUndefined();
    await api.ai.addMessage('conversation 1', {
      role: 'user',
      encryptedContent: 'encrypted-content'
    });
    await api.ai.recordUsage({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      modelId: 'mistralai/mistral-7b-instruct',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: 'cursor-1',
      limit: 10
    });
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    expect(wasApiRequestMade('GET', '/vfs/keys/me')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/keys')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/items/item%201/shares')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item%201/shares')).toBe(true);
    expect(wasApiRequestMade('PATCH', '/vfs/shares/share%201')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/vfs/shares/share%201')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item%201/org-shares')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/vfs/org-shares/org%20share%201')).toBe(
      true
    );
    expect(wasApiRequestMade('GET', '/vfs/share-targets/search')).toBe(true);

    expect(wasApiRequestMade('POST', '/ai/conversations')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/conversations')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/conversations/conversation%201')).toBe(
      true
    );
    expect(
      wasApiRequestMade('PATCH', '/ai/conversations/conversation%201')
    ).toBe(true);
    expect(
      wasApiRequestMade('DELETE', '/ai/conversations/conversation%201')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/ai/conversations/conversation%201/messages')
    ).toBe(true);
    expect(wasApiRequestMade('POST', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage/summary')).toBe(true);

    const recordedRequests = getRecordedApiRequests();
    expect(
      recordedRequests.some(
        (request) =>
          request.pathname === '/vfs/share-targets/search' &&
          request.url.includes('q=test+query') &&
          request.url.includes('type=user')
      )
    ).toBe(true);
    expect(
      recordedRequests.some(
        (request) =>
          request.pathname === '/ai/usage' &&
          request.url.includes('startDate=2024-01-01') &&
          request.url.includes('endDate=2024-01-31') &&
          request.url.includes('cursor=cursor-1') &&
          request.url.includes('limit=10')
      )
    ).toBe(true);
  });

  it('covers non-wrapper API parity endpoints', async () => {
    const billing = await fetch('http://localhost/billing/organizations/org-1');
    const emails = await fetch('http://localhost/emails');
    const emailDrafts = await fetch('http://localhost/emails/drafts');
    const sendEmail = await fetch('http://localhost/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'user@example.com' })
    });
    const deleteEmail = await fetch('http://localhost/emails/email-1', {
      method: 'DELETE'
    });
    const mlsGet = await fetch('http://localhost/mls/groups');
    const mlsPost = await fetch('http://localhost/mls/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'group' })
    });
    const mlsPatch = await fetch('http://localhost/mls/groups/group-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'updated' })
    });
    const mlsDelete = await fetch('http://localhost/mls/groups/group-1', {
      method: 'DELETE'
    });
    const revenuecat = await fetch('http://localhost/revenuecat/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'purchase' })
    });
    const sse = await fetch('http://localhost/sse');

    expect(billing.ok).toBe(true);
    expect(emails.ok).toBe(true);
    expect(emailDrafts.ok).toBe(true);
    expect(sendEmail.ok).toBe(true);
    expect(deleteEmail.ok).toBe(true);
    expect(mlsGet.ok).toBe(true);
    expect(mlsPost.ok).toBe(true);
    expect(mlsPatch.ok).toBe(true);
    expect(mlsDelete.ok).toBe(true);
    expect(revenuecat.ok).toBe(true);
    expect(sse.ok).toBe(true);
    expect(sse.headers.get('content-type')).toContain('text/event-stream');

    expect(wasApiRequestMade('GET', '/billing/organizations/org-1')).toBe(true);
    expect(wasApiRequestMade('GET', '/emails')).toBe(true);
    expect(wasApiRequestMade('GET', '/emails/drafts')).toBe(true);
    expect(wasApiRequestMade('POST', '/emails/send')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/emails/email-1')).toBe(true);
    expect(wasApiRequestMade('GET', '/mls/groups')).toBe(true);
    expect(wasApiRequestMade('POST', '/mls/groups')).toBe(true);
    expect(wasApiRequestMade('PATCH', '/mls/groups/group-1')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/mls/groups/group-1')).toBe(true);
    expect(wasApiRequestMade('POST', '/revenuecat/webhooks')).toBe(true);
    expect(wasApiRequestMade('GET', '/sse')).toBe(true);
  });
});
