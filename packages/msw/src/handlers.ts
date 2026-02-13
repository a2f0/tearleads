import type {
  AddAiMessageResponse,
  AdminAccessContextResponse,
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdateResponse,
  AiConversation,
  AiConversationDetailResponse,
  AiConversationResponse,
  AiConversationsListResponse,
  AiMessage,
  AiUsage,
  AiUsageListResponse,
  AiUsageSummary,
  AiUsageSummaryResponse,
  AuthResponse,
  CreateAiConversationResponse,
  Group,
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
  Organization,
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
  RedisKeyValueResponse,
  SessionsResponse,
  ShareTargetSearchResponse,
  VfsOrgShare,
  VfsRegisterResponse,
  VfsShare,
  VfsSharesResponse,
  VfsUserKeysResponse
} from '@tearleads/shared';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord,
  validateChatMessages
} from '@tearleads/shared';
import { HttpResponse, http } from 'msw';

const ok = <T extends object>(body: T) => HttpResponse.json(body);

const withOptionalV1Prefix = (pathPattern: string): RegExp =>
  new RegExp(`(?:/v1)?${pathPattern}$`);

const nowIsoString = (): string => '2024-01-01T12:00:00.000Z';

const defaultKeys: RedisKeysResponse['keys'] = Array.from(
  { length: 25 },
  (_, index) => ({
    key: `key:${index + 1}`,
    type: 'string',
    ttl: -1
  })
);

const defaultKeyValue = (key: string): RedisKeyValueResponse => ({
  key,
  type: 'string',
  ttl: -1,
  value: ''
});

const defaultPostgresInfo: PostgresAdminInfoResponse = {
  status: 'ok',
  info: {
    host: 'localhost',
    port: 5432,
    database: 'tearleads',
    user: 'tearleads'
  },
  serverVersion: 'PostgreSQL 15.1'
};

const defaultPostgresTables: PostgresTablesResponse = {
  tables: [
    {
      schema: 'public',
      name: 'users',
      rowCount: 12,
      totalBytes: 2048,
      tableBytes: 1024,
      indexBytes: 1024
    }
  ]
};

const defaultPostgresColumns: PostgresColumnsResponse = {
  columns: [
    {
      name: 'id',
      type: 'text',
      nullable: false,
      defaultValue: null,
      ordinalPosition: 1
    }
  ]
};

const defaultPostgresRows: PostgresRowsResponse = {
  rows: [{ id: 'row-1' }],
  totalCount: 1,
  limit: 50,
  offset: 0
};

const defaultAuthResponse: AuthResponse = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  tokenType: 'Bearer',
  expiresIn: 3600,
  refreshExpiresIn: 604800,
  user: {
    id: 'user-1',
    email: 'user@example.com'
  }
};

const defaultSessionsResponse: SessionsResponse = {
  sessions: [
    {
      id: 'session-1',
      createdAt: nowIsoString(),
      lastActiveAt: nowIsoString(),
      ipAddress: '127.0.0.1',
      isCurrent: true,
      isAdmin: false
    }
  ]
};

const defaultAdminContext: AdminAccessContextResponse = {
  isRootAdmin: true,
  organizations: [{ id: 'org-1', name: 'Acme Org' }],
  defaultOrganizationId: 'org-1'
};

const defaultGroup: Group = {
  id: 'group-1',
  organizationId: 'org-1',
  name: 'Core Team',
  description: null,
  createdAt: nowIsoString(),
  updatedAt: nowIsoString()
};

const defaultGroupsList: GroupsListResponse = {
  groups: [
    {
      ...defaultGroup,
      memberCount: 2
    }
  ]
};

const defaultGroupMembers: GroupMembersResponse = {
  members: [
    {
      userId: 'user-1',
      email: 'user@example.com',
      joinedAt: nowIsoString()
    }
  ]
};

const defaultGroupDetail: GroupDetailResponse = {
  group: defaultGroup,
  members: defaultGroupMembers.members
};

const defaultOrganization: Organization = {
  id: 'org-1',
  name: 'Acme Org',
  description: null,
  createdAt: nowIsoString(),
  updatedAt: nowIsoString()
};

const defaultOrganizationsList: OrganizationsListResponse = {
  organizations: [defaultOrganization]
};

const defaultOrganizationResponse: OrganizationResponse = {
  organization: defaultOrganization
};

const defaultOrganizationUsers: OrganizationUsersResponse = {
  users: [
    {
      id: 'user-1',
      email: 'user@example.com',
      joinedAt: nowIsoString()
    }
  ]
};

const defaultOrganizationGroups: OrganizationGroupsResponse = {
  groups: [
    {
      id: defaultGroup.id,
      name: defaultGroup.name,
      description: defaultGroup.description,
      memberCount: 2
    }
  ]
};

const defaultVfsKeys: VfsUserKeysResponse = {
  publicEncryptionKey: 'pub-enc-key',
  publicSigningKey: 'pub-sign-key',
  encryptedPrivateKeys: 'encrypted-private-keys',
  argon2Salt: 'argon2-salt'
};

const defaultVfsShare: VfsShare = {
  id: 'share-1',
  itemId: 'item-1',
  shareType: 'user',
  targetId: 'user-2',
  targetName: 'User Two',
  permissionLevel: 'view',
  createdBy: 'user-1',
  createdByEmail: 'user@example.com',
  createdAt: nowIsoString(),
  expiresAt: null
};

const defaultVfsOrgShare: VfsOrgShare = {
  id: 'org-share-1',
  sourceOrgId: 'org-1',
  sourceOrgName: 'Acme Org',
  targetOrgId: 'org-2',
  targetOrgName: 'Partner Org',
  itemId: 'item-1',
  permissionLevel: 'view',
  createdBy: 'user-1',
  createdByEmail: 'user@example.com',
  createdAt: nowIsoString(),
  expiresAt: null
};

const defaultVfsSharesResponse: VfsSharesResponse = {
  shares: [defaultVfsShare],
  orgShares: [defaultVfsOrgShare]
};

const defaultShareTargetSearchResponse: ShareTargetSearchResponse = {
  results: [
    {
      id: 'user-2',
      type: 'user',
      name: 'User Two',
      description: 'Teammate'
    }
  ]
};

const defaultAiConversation: AiConversation = {
  id: 'conversation-1',
  userId: 'user-1',
  organizationId: null,
  encryptedTitle: 'encrypted-title',
  encryptedSessionKey: 'encrypted-session-key',
  modelId: DEFAULT_OPENROUTER_MODEL_ID,
  messageCount: 1,
  createdAt: nowIsoString(),
  updatedAt: nowIsoString()
};

const defaultAiMessage: AiMessage = {
  id: 'message-1',
  conversationId: defaultAiConversation.id,
  role: 'assistant',
  encryptedContent: 'encrypted-content',
  modelId: DEFAULT_OPENROUTER_MODEL_ID,
  sequenceNumber: 1,
  createdAt: nowIsoString()
};

const defaultAiUsageSummary: AiUsageSummary = {
  totalPromptTokens: 120,
  totalCompletionTokens: 80,
  totalTokens: 200,
  requestCount: 3,
  periodStart: '2024-01-01T00:00:00.000Z',
  periodEnd: '2024-01-31T23:59:59.999Z'
};

const defaultAiUsage: AiUsage = {
  id: 'usage-1',
  conversationId: defaultAiConversation.id,
  messageId: defaultAiMessage.id,
  userId: 'user-1',
  organizationId: null,
  modelId: DEFAULT_OPENROUTER_MODEL_ID,
  promptTokens: 120,
  completionTokens: 80,
  totalTokens: 200,
  openrouterRequestId: null,
  createdAt: nowIsoString()
};

const defaultBillingAccountResponse: OrganizationBillingAccountResponse = {
  billingAccount: {
    organizationId: 'org-1',
    revenueCatAppUserId: 'rc-user-1',
    entitlementStatus: 'active',
    activeProductId: 'tearleads_pro',
    periodEndsAt: nowIsoString(),
    willRenew: true,
    lastWebhookEventId: null,
    lastWebhookAt: null,
    createdAt: nowIsoString(),
    updatedAt: nowIsoString()
  }
};

const initialAdminUsers: AdminUsersResponse['users'] = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    emailConfirmed: true,
    admin: true,
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    markedForDeletionAt: null,
    markedForDeletionBy: null,
    organizationIds: ['org-1'],
    createdAt: '2024-01-01T12:00:00.000Z',
    lastActiveAt: '2024-01-10T18:30:00.000Z',
    accounting: {
      totalPromptTokens: 120,
      totalCompletionTokens: 80,
      totalTokens: 200,
      requestCount: 3,
      lastUsedAt: '2024-01-09T12:00:00.000Z'
    }
  },
  {
    id: 'user-2',
    email: 'user@example.com',
    emailConfirmed: false,
    admin: false,
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    markedForDeletionAt: null,
    markedForDeletionBy: null,
    organizationIds: [],
    createdAt: '2024-02-14T08:15:00.000Z',
    lastActiveAt: null,
    accounting: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastUsedAt: null
    }
  }
];

let adminUsers: AdminUsersResponse['users'] =
  structuredClone(initialAdminUsers);

export const resetMockApiState = (): void => {
  adminUsers = structuredClone(initialAdminUsers);
};

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
    ok<AdminUsersResponse>({ users: adminUsers })
  ),
  http.get(withOptionalV1Prefix('/admin/users/[^/]+'), ({ request }) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const user = adminUsers.find((adminUser) => adminUser.id === id);

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
      const existingUser = adminUsers.find((user) => user.id === id);
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

      adminUsers = adminUsers.map((user) =>
        user.id === id ? updatedUser : user
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

  http.get(withOptionalV1Prefix('/emails/drafts'), () => ok({ drafts: [] })),
  http.get(withOptionalV1Prefix('/emails/drafts/[^/]+'), () =>
    ok({ draft: null })
  ),
  http.post(withOptionalV1Prefix('/emails/drafts'), () =>
    ok({ draft: { id: 'draft-1' } })
  ),
  http.delete(withOptionalV1Prefix('/emails/drafts/[^/]+'), () =>
    ok({ deleted: true })
  ),
  http.post(withOptionalV1Prefix('/emails/send'), () => ok({ sent: true })),
  http.get(withOptionalV1Prefix('/emails'), () => ok({ emails: [] })),
  http.get(withOptionalV1Prefix('/emails/[^/]+'), () => ok({ email: null })),
  http.delete(withOptionalV1Prefix('/emails/[^/]+'), () =>
    ok({ deleted: true })
  ),

  http.get(withOptionalV1Prefix('/ai/conversations'), () => {
    const response: AiConversationsListResponse = {
      conversations: [defaultAiConversation],
      hasMore: false
    };
    return ok(response);
  }),
  http.get(withOptionalV1Prefix('/ai/conversations/[^/]+'), () => {
    const response: AiConversationDetailResponse = {
      conversation: defaultAiConversation,
      messages: [defaultAiMessage]
    };
    return ok(response);
  }),
  http.post(withOptionalV1Prefix('/ai/conversations'), () => {
    const response: CreateAiConversationResponse = {
      conversation: defaultAiConversation
    };
    return ok(response);
  }),
  http.post(withOptionalV1Prefix('/ai/conversations/[^/]+/messages'), () => {
    const response: AddAiMessageResponse = {
      message: defaultAiMessage,
      conversation: defaultAiConversation
    };
    return ok(response);
  }),
  http.patch(withOptionalV1Prefix('/ai/conversations/[^/]+'), () => {
    const response: AiConversationResponse = {
      conversation: defaultAiConversation
    };
    return ok(response);
  }),
  http.delete(
    withOptionalV1Prefix('/ai/conversations/[^/]+'),
    () => new HttpResponse(null, { status: 204 })
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
