import type {
  AdminAccessContextResponse,
  AdminUsersResponse,
  AiConversation,
  AiMessage,
  AiUsage,
  AiUsageSummary,
  AuthResponse,
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
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse,
  SessionsResponse,
  ShareTargetSearchResponse,
  VfsOrgShare,
  VfsCrdtPushResponse,
  VfsCrdtReconcileResponse,
  VfsCrdtSyncResponse,
  VfsShare,
  VfsSyncReconcileResponse,
  VfsSyncResponse,
  VfsSharesResponse,
  VfsUserKeysResponse
} from '@tearleads/shared';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
} from '@tearleads/shared';
import { HttpResponse } from 'msw';

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

const defaultVfsSyncCursor =
  'eyJ2ZXJzaW9uIjoxLCJjaGFuZ2VkQXQiOiIyMDI0LTAxLTAxVDEyOjAwOjAwLjAwMFoiLCJjaGFuZ2VJZCI6ImNoYW5nZS0xIn0';

const defaultVfsSyncResponse: VfsSyncResponse = {
  items: [],
  nextCursor: null,
  hasMore: false
};

const defaultVfsSyncReconcileResponse: VfsSyncReconcileResponse = {
  clientId: 'desktop',
  cursor: defaultVfsSyncCursor
};

const defaultVfsCrdtSyncResponse: VfsCrdtSyncResponse = {
  items: [],
  nextCursor: null,
  hasMore: false,
  lastReconciledWriteIds: {}
};

const defaultVfsCrdtPushResponse: VfsCrdtPushResponse = {
  clientId: 'desktop',
  results: []
};

const defaultVfsCrdtReconcileResponse: VfsCrdtReconcileResponse = {
  clientId: 'desktop',
  cursor: defaultVfsSyncCursor,
  lastReconciledWriteIds: {}
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

export const getAdminUsers = (): AdminUsersResponse['users'] => adminUsers;

export const setAdminUsers = (nextUsers: AdminUsersResponse['users']): void => {
  adminUsers = nextUsers;
};

export {
  defaultAdminContext,
  defaultAiConversation,
  defaultAiMessage,
  defaultAiUsage,
  defaultAiUsageSummary,
  defaultAuthResponse,
  defaultBillingAccountResponse,
  defaultGroup,
  defaultGroupDetail,
  defaultGroupMembers,
  defaultGroupsList,
  defaultKeyValue,
  defaultKeys,
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
};
