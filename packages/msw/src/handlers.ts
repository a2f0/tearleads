import type {
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdateResponse,
  AiUsageListResponse,
  AiUsageSummaryResponse,
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
  OrganizationBillingAccountResponse,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse,
  OrganizationUsersResponse,
  PingData,
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RecordAiUsageResponse,
  RedisKeysResponse,
  ShareTargetSearchResponse,
  VfsCrdtPushResponse,
  VfsCrdtReconcileResponse,
  VfsCrdtSyncResponse,
  VfsRegisterResponse,
  VfsRekeyResponse,
  VfsSharesResponse,
  VfsSyncReconcileResponse,
  VfsSyncResponse,
  VfsUserKeysResponse
} from '@tearleads/shared';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord,
  validateChatMessages
} from '@tearleads/shared';
import { HttpResponse, http } from 'msw';
import {
  defaultAdminContext,
  defaultAiUsage,
  defaultAiUsageSummary,
  defaultAuthResponse,
  defaultBillingAccountResponse,
  defaultGroup,
  defaultGroupDetail,
  defaultGroupMembers,
  defaultGroupsList,
  defaultKeys,
  defaultKeyValue,
  defaultOrganization,
  defaultOrganizationGroups,
  defaultOrganizationResponse,
  defaultOrganizationsList,
  defaultOrganizationUsers,
  defaultPostgresColumns,
  defaultPostgresInfo,
  defaultPostgresRows,
  defaultPostgresTables,
  defaultSessionsResponse,
  defaultShareTargetSearchResponse,
  defaultVfsCrdtPushResponse,
  defaultVfsCrdtReconcileResponse,
  defaultVfsCrdtSyncResponse,
  defaultVfsKeys,
  defaultVfsOrgShare,
  defaultVfsShare,
  defaultVfsSharesResponse,
  defaultVfsSyncReconcileResponse,
  defaultVfsSyncResponse,
  nowIsoString,
  ok,
  withOptionalV1Prefix
} from './handlerData.js';
import {
  getAdminUsers,
  resetMockApiState,
  setAdminUsers
} from './handlerState.js';
export { resetMockApiState };
export const handlers = [
  http.get(withOptionalV1Prefix('/ping'), () =>
    ok<PingData>({ version: 'test', dbVersion: '0' })
  ),
  http.post(withOptionalV1Prefix('/auth/login'), () => ok(defaultAuthResponse)),
  http.post(withOptionalV1Prefix('/auth/register'), () =>
    ok(defaultAuthResponse)
  ),
  http.post(withOptionalV1Prefix('/auth/refresh'), () =>
    ok(defaultAuthResponse)
  ),
  http.post(withOptionalV1Prefix('/auth/logout'), () =>
    ok({ loggedOut: true })
  ),
  http.get(withOptionalV1Prefix('/auth/sessions'), () =>
    ok(defaultSessionsResponse)
  ),
  http.delete(withOptionalV1Prefix('/auth/sessions/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.get(withOptionalV1Prefix('/admin/context'), () =>
    ok(defaultAdminContext)
  ),
  http.get(withOptionalV1Prefix('/admin/postgres/info'), () =>
    ok<PostgresAdminInfoResponse>(defaultPostgresInfo)
  ),
  http.get(withOptionalV1Prefix('/admin/postgres/tables'), () =>
    ok<PostgresTablesResponse>(defaultPostgresTables)
  ),
  http.get(
    withOptionalV1Prefix('/admin/postgres/tables/[^/]+/[^/]+/columns'),
    () => ok<PostgresColumnsResponse>(defaultPostgresColumns)
  ),
  http.get(
    withOptionalV1Prefix('/admin/postgres/tables/[^/]+/[^/]+/rows'),
    () => ok<PostgresRowsResponse>(defaultPostgresRows)
  ),
  http.get(withOptionalV1Prefix('/admin/redis/dbsize'), () =>
    ok({ count: defaultKeys.length })
  ),
  http.get(withOptionalV1Prefix('/admin/redis/keys'), ({ request }) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor') ?? '0';
    const limit = Number(url.searchParams.get('limit') ?? '10');
    const start = Number(cursor) || 0;
    const end = start + limit;
    const pageKeys = defaultKeys.slice(start, end);
    const nextCursor = end < defaultKeys.length ? String(end) : '0';
    return ok<RedisKeysResponse>({
      keys: pageKeys,
      cursor: nextCursor,
      hasMore: nextCursor !== '0'
    });
  }),
  http.get(withOptionalV1Prefix('/admin/redis/keys/[^/]+'), ({ request }) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    return ok(defaultKeyValue(key));
  }),
  http.delete(withOptionalV1Prefix('/admin/redis/keys/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.get(withOptionalV1Prefix('/admin/users'), () =>
    ok<AdminUsersResponse>({ users: getAdminUsers() })
  ),
  http.get(withOptionalV1Prefix('/admin/users/[^/]+'), ({ request }) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const user = getAdminUsers().find((adminUser) => adminUser.id === id);
    if (!user) {
      return HttpResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const response: AdminUserResponse = { user };
    return ok(response);
  }),
  http.patch(
    withOptionalV1Prefix('/admin/users/[^/]+'),
    async ({ request }) => {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      const body = await request.json().catch(() => null);
      const existingUser = getAdminUsers().find((user) => user.id === id);
      if (!existingUser) {
        return HttpResponse.json({ error: 'User not found' }, { status: 404 });
      }
      const email =
        isRecord(body) && typeof body['email'] === 'string'
          ? body['email']
          : existingUser.email;
      const emailConfirmed =
        isRecord(body) && typeof body['emailConfirmed'] === 'boolean'
          ? body['emailConfirmed']
          : existingUser.emailConfirmed;
      const admin =
        isRecord(body) && typeof body['admin'] === 'boolean'
          ? body['admin']
          : existingUser.admin;
      const updatedUser = {
        ...existingUser,
        email,
        emailConfirmed,
        admin
      };
      setAdminUsers(
        getAdminUsers().map((user) => (user.id === id ? updatedUser : user))
      );
      const response: AdminUserUpdateResponse = { user: updatedUser };
      return ok(response);
    }
  ),
  http.get(withOptionalV1Prefix('/admin/groups'), () =>
    ok<GroupsListResponse>(defaultGroupsList)
  ),
  http.get(withOptionalV1Prefix('/admin/groups/[^/]+/members'), () =>
    ok<GroupMembersResponse>(defaultGroupMembers)
  ),
  http.get(withOptionalV1Prefix('/admin/groups/[^/]+'), () =>
    ok<GroupDetailResponse>(defaultGroupDetail)
  ),
  http.post(withOptionalV1Prefix('/admin/groups'), () =>
    ok({ group: defaultGroup })
  ),
  http.post(withOptionalV1Prefix('/admin/groups/[^/]+/members'), () =>
    ok({ added: true })
  ),
  http.put(withOptionalV1Prefix('/admin/groups/[^/]+'), () =>
    ok({ group: defaultGroup })
  ),
  http.delete(withOptionalV1Prefix('/admin/groups/[^/]+/members/[^/]+'), () =>
    ok({ removed: true })
  ),
  http.delete(withOptionalV1Prefix('/admin/groups/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.get(withOptionalV1Prefix('/admin/organizations'), () =>
    ok<OrganizationsListResponse>(defaultOrganizationsList)
  ),
  http.get(withOptionalV1Prefix('/admin/organizations/[^/]+/users'), () =>
    ok<OrganizationUsersResponse>(defaultOrganizationUsers)
  ),
  http.get(withOptionalV1Prefix('/admin/organizations/[^/]+/groups'), () =>
    ok<OrganizationGroupsResponse>(defaultOrganizationGroups)
  ),
  http.get(withOptionalV1Prefix('/admin/organizations/[^/]+'), () =>
    ok<OrganizationResponse>(defaultOrganizationResponse)
  ),
  http.post(withOptionalV1Prefix('/admin/organizations'), () =>
    ok({ organization: defaultOrganization })
  ),
  http.put(withOptionalV1Prefix('/admin/organizations/[^/]+'), () =>
    ok({ organization: defaultOrganization })
  ),
  http.delete(withOptionalV1Prefix('/admin/organizations/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.get(withOptionalV1Prefix('/billing/organizations/[^/]+'), () =>
    ok<OrganizationBillingAccountResponse>(defaultBillingAccountResponse)
  ),
  http.post(withOptionalV1Prefix('/chat/completions'), async ({ request }) => {
    const body = await request.json().catch(() => null);
    const messages = isRecord(body) ? body['messages'] : null;
    const model = isRecord(body) ? body['model'] : undefined;
    const messageResult = validateChatMessages(messages);
    if (!messageResult.ok) {
      return HttpResponse.json({ error: messageResult.error }, { status: 400 });
    }
    if (
      model !== undefined &&
      (typeof model !== 'string' || !isOpenRouterModelId(model))
    ) {
      return HttpResponse.json(
        { error: 'model must be a supported OpenRouter chat model' },
        { status: 400 }
      );
    }
    return ok({
      id: 'chatcmpl-test',
      model: DEFAULT_OPENROUTER_MODEL_ID,
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Mock reply'
          }
        }
      ]
    });
  }),
  http.post(withOptionalV1Prefix('/vfs/emails/send'), () => ok({ sent: true })),
  http.get(withOptionalV1Prefix('/vfs/emails'), () => ok({ emails: [] })),
  http.get(withOptionalV1Prefix('/vfs/emails/[^/]+'), () =>
    ok({ email: null })
  ),
  http.delete(withOptionalV1Prefix('/vfs/emails/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.post(withOptionalV1Prefix('/ai/usage'), () => {
    const response: RecordAiUsageResponse = {
      usage: defaultAiUsage
    };
    return ok(response);
  }),
  http.get(withOptionalV1Prefix('/ai/usage'), () => {
    const response: AiUsageListResponse = {
      usage: [defaultAiUsage],
      summary: defaultAiUsageSummary,
      hasMore: false
    };
    return ok(response);
  }),
  http.get(withOptionalV1Prefix('/ai/usage/summary'), () => {
    const response: AiUsageSummaryResponse = {
      summary: defaultAiUsageSummary,
      byModel: {
        [DEFAULT_OPENROUTER_MODEL_ID]: defaultAiUsageSummary
      }
    };
    return ok(response);
  }),
  http.get(withOptionalV1Prefix('/vfs/keys/me'), () =>
    ok<VfsUserKeysResponse>(defaultVfsKeys)
  ),
  http.post(withOptionalV1Prefix('/vfs/keys'), () => ok({ created: true })),
  http.post(withOptionalV1Prefix('/vfs/register'), () => {
    const response: VfsRegisterResponse = {
      id: 'item-1',
      createdAt: nowIsoString()
    };
    return ok(response);
  }),
  http.get(withOptionalV1Prefix('/vfs/vfs-sync'), () =>
    ok<VfsSyncResponse>(defaultVfsSyncResponse)
  ),
  http.post(withOptionalV1Prefix('/vfs/vfs-sync/reconcile'), () =>
    ok<VfsSyncReconcileResponse>(defaultVfsSyncReconcileResponse)
  ),
  http.get(withOptionalV1Prefix('/vfs/crdt/vfs-sync'), () =>
    ok<VfsCrdtSyncResponse>(defaultVfsCrdtSyncResponse)
  ),
  http.post(withOptionalV1Prefix('/vfs/crdt/push'), () =>
    ok<VfsCrdtPushResponse>(defaultVfsCrdtPushResponse)
  ),
  http.post(withOptionalV1Prefix('/vfs/crdt/reconcile'), () =>
    ok<VfsCrdtReconcileResponse>(defaultVfsCrdtReconcileResponse)
  ),
  http.post(withOptionalV1Prefix('/vfs/blobs/stage'), () =>
    ok({
      stagingId: 'staging-1',
      blobId: 'blob-1',
      status: 'staged',
      stagedAt: nowIsoString(),
      expiresAt: '2024-01-02T12:00:00.000Z'
    })
  ),
  http.post(withOptionalV1Prefix('/vfs/blobs/stage/[^/]+/attach'), () =>
    ok({
      stagingId: 'staging-1',
      blobId: 'blob-1',
      itemId: 'item-1',
      relationKind: 'content',
      status: 'attached',
      attachedAt: nowIsoString()
    })
  ),
  http.post(withOptionalV1Prefix('/vfs/blobs/stage/[^/]+/abandon'), () =>
    ok({
      stagingId: 'staging-1',
      blobId: 'blob-1',
      status: 'abandoned',
      abandonedAt: nowIsoString()
    })
  ),
  http.get(withOptionalV1Prefix('/vfs/items/[^/]+/shares'), () =>
    ok<VfsSharesResponse>(defaultVfsSharesResponse)
  ),
  http.post(withOptionalV1Prefix('/vfs/items/[^/]+/shares'), () =>
    ok({ share: defaultVfsShare })
  ),
  http.patch(withOptionalV1Prefix('/vfs/shares/[^/]+'), () =>
    ok({ share: defaultVfsShare })
  ),
  http.delete(withOptionalV1Prefix('/vfs/shares/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.post(withOptionalV1Prefix('/vfs/items/[^/]+/org-shares'), () =>
    ok({ orgShare: defaultVfsOrgShare })
  ),
  http.delete(withOptionalV1Prefix('/vfs/org-shares/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.post(withOptionalV1Prefix('/vfs/items/[^/]+/rekey'), () => {
    const response: VfsRekeyResponse = {
      itemId: 'item-1',
      newEpoch: 2,
      wrapsApplied: 1
    };
    return ok(response);
  }),
  http.get(withOptionalV1Prefix('/vfs/share-targets/search'), () =>
    ok<ShareTargetSearchResponse>(defaultShareTargetSearchResponse)
  ),
  http.get(
    withOptionalV1Prefix('/sse'),
    () =>
      new HttpResponse('event: connected\\ndata: {}\\n\\n', {
        headers: {
          'Content-Type': 'text/event-stream'
        }
      })
  ),
  http.get(withOptionalV1Prefix('/mls/groups'), () => ok({ ok: true })),
  http.get(withOptionalV1Prefix('/mls/groups/[^/]+/members'), () =>
    ok({ ok: true })
  ),
  http.get(withOptionalV1Prefix('/mls/groups/[^/]+/messages'), () =>
    ok({ ok: true })
  ),
  http.get(withOptionalV1Prefix('/mls/groups/[^/]+/state'), () =>
    ok({ ok: true })
  ),
  http.get(withOptionalV1Prefix('/mls/groups/[^/]+'), () => ok({ ok: true })),
  http.get(withOptionalV1Prefix('/mls/key-packages/me'), () =>
    ok({ ok: true })
  ),
  http.get(withOptionalV1Prefix('/mls/key-packages/[^/]+'), () =>
    ok({ ok: true })
  ),
  http.get(withOptionalV1Prefix('/mls/welcome-messages'), () =>
    ok({ ok: true })
  ),
  http.post(withOptionalV1Prefix('/mls/groups'), () => ok({ ok: true })),
  http.post(withOptionalV1Prefix('/mls/groups/[^/]+/members'), () =>
    ok({ ok: true })
  ),
  http.post(withOptionalV1Prefix('/mls/groups/[^/]+/messages'), () =>
    ok({ ok: true })
  ),
  http.post(withOptionalV1Prefix('/mls/groups/[^/]+/state'), () =>
    ok({ ok: true })
  ),
  http.post(withOptionalV1Prefix('/mls/key-packages'), () => ok({ ok: true })),
  http.post(withOptionalV1Prefix('/mls/welcome-messages/[^/]+/ack'), () =>
    ok({ ok: true })
  ),
  http.patch(withOptionalV1Prefix('/mls/groups/[^/]+'), () => ok({ ok: true })),
  http.delete(withOptionalV1Prefix('/mls/groups/[^/]+/members/[^/]+'), () =>
    ok({ ok: true })
  ),
  http.delete(withOptionalV1Prefix('/mls/groups/[^/]+'), () =>
    ok({ ok: true })
  ),
  http.delete(withOptionalV1Prefix('/mls/key-packages/[^/]+'), () =>
    ok({ ok: true })
  ),
  http.post(withOptionalV1Prefix('/revenuecat/webhooks'), () =>
    ok({ received: true })
  )
];
