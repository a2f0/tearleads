import type { TableDefinition } from './types.js';

// Re-export from split modules
export {
  mlsGroupMembersTable,
  mlsGroupStateTable,
  mlsGroupsTable,
  mlsKeyPackagesTable,
  mlsMessagesTable,
  mlsWelcomeMessagesTable,
  runtimeAiMlsTables
} from './definition-runtime-ai-mls.js';

// Import for combining into runtimeAiTables
import { runtimeAiMlsTables } from './definition-runtime-ai-mls.js';

export const vfsCrdtOpsTable: TableDefinition = {
  name: 'vfs_crdt_ops',
  propertyName: 'vfsCrdtOps',
  comment:
    'CRDT-style operation log for ACL and link mutations.\nEnsures deterministic convergence for concurrent multi-client updates.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    itemId: {
      type: 'text',
      sqlName: 'item_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    opType: {
      type: 'text',
      sqlName: 'op_type',
      notNull: true,
      enumValues: ['acl_add', 'acl_remove', 'link_add', 'link_remove'] as const
    },
    principalType: {
      type: 'text',
      sqlName: 'principal_type',
      enumValues: ['user', 'group', 'organization'] as const
    },
    principalId: {
      type: 'text',
      sqlName: 'principal_id'
    },
    accessLevel: {
      type: 'text',
      sqlName: 'access_level',
      enumValues: ['read', 'write', 'admin'] as const
    },
    parentId: {
      type: 'text',
      sqlName: 'parent_id'
    },
    childId: {
      type: 'text',
      sqlName: 'child_id'
    },
    actorId: {
      type: 'text',
      sqlName: 'actor_id',
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'set null'
      }
    },
    sourceTable: {
      type: 'text',
      sqlName: 'source_table',
      notNull: true
    },
    sourceId: {
      type: 'text',
      sqlName: 'source_id',
      notNull: true
    },
    occurredAt: {
      type: 'timestamp',
      sqlName: 'occurred_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'vfs_crdt_ops_item_idx', columns: ['itemId'] },
    { name: 'vfs_crdt_ops_occurred_idx', columns: ['occurredAt'] },
    { name: 'vfs_crdt_ops_source_idx', columns: ['sourceTable', 'sourceId'] }
  ]
};

// =============================================================================
// AI Conversation & Usage Tables
// =============================================================================
// Design Note: Messages are encrypted client-side following the VFS pattern.
// Usage data (token counts) is stored in plaintext for billing/analytics.

/**
 * AI conversations - stores encrypted conversation metadata.
 * Each conversation belongs to a user and optionally an organization.
 */
export const aiConversationsTable: TableDefinition = {
  name: 'ai_conversations',
  propertyName: 'aiConversations',
  comment:
    'AI conversations - stores encrypted conversation metadata.\nEach conversation belongs to a user and optionally an organization.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'set null'
      }
    },
    encryptedTitle: {
      type: 'text',
      sqlName: 'encrypted_title',
      notNull: true
    },
    encryptedSessionKey: {
      type: 'text',
      sqlName: 'encrypted_session_key',
      notNull: true
    },
    modelId: {
      type: 'text',
      sqlName: 'model_id'
    },
    messageCount: {
      type: 'integer',
      sqlName: 'message_count',
      notNull: true,
      defaultValue: 0
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    },
    updatedAt: {
      type: 'timestamp',
      sqlName: 'updated_at',
      notNull: true
    },
    deleted: {
      type: 'boolean',
      sqlName: 'deleted',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [
    {
      name: 'ai_conversations_user_idx',
      columns: ['userId', 'deleted', 'updatedAt']
    },
    { name: 'ai_conversations_org_idx', columns: ['organizationId'] }
  ]
};

/**
 * AI messages - stores encrypted message content.
 * Messages are encrypted client-side before storage.
 */
export const aiMessagesTable: TableDefinition = {
  name: 'ai_messages',
  propertyName: 'aiMessages',
  comment:
    'AI messages - stores encrypted message content.\nMessages are encrypted client-side before storage.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    conversationId: {
      type: 'text',
      sqlName: 'conversation_id',
      notNull: true,
      references: {
        table: 'ai_conversations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    role: {
      type: 'text',
      sqlName: 'role',
      notNull: true,
      enumValues: ['system', 'user', 'assistant'] as const
    },
    encryptedContent: {
      type: 'text',
      sqlName: 'encrypted_content',
      notNull: true
    },
    modelId: {
      type: 'text',
      sqlName: 'model_id'
    },
    sequenceNumber: {
      type: 'integer',
      sqlName: 'sequence_number',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'ai_messages_conversation_idx',
      columns: ['conversationId', 'sequenceNumber']
    }
  ]
};

/**
 * AI usage - tracks token usage per request for billing/analytics.
 * Usage data is stored in plaintext (not encrypted) for aggregation.
 */
export const aiUsageTable: TableDefinition = {
  name: 'ai_usage',
  propertyName: 'aiUsage',
  comment:
    'AI usage - tracks token usage per request for billing/analytics.\nUsage data is stored in plaintext (not encrypted) for aggregation.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    conversationId: {
      type: 'text',
      sqlName: 'conversation_id',
      references: {
        table: 'ai_conversations',
        column: 'id',
        onDelete: 'set null'
      }
    },
    messageId: {
      type: 'text',
      sqlName: 'message_id',
      references: {
        table: 'ai_messages',
        column: 'id',
        onDelete: 'set null'
      }
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'set null'
      }
    },
    modelId: {
      type: 'text',
      sqlName: 'model_id',
      notNull: true
    },
    promptTokens: {
      type: 'integer',
      sqlName: 'prompt_tokens',
      notNull: true
    },
    completionTokens: {
      type: 'integer',
      sqlName: 'completion_tokens',
      notNull: true
    },
    totalTokens: {
      type: 'integer',
      sqlName: 'total_tokens',
      notNull: true
    },
    openrouterRequestId: {
      type: 'text',
      sqlName: 'openrouter_request_id'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'ai_usage_user_idx', columns: ['userId', 'createdAt'] },
    { name: 'ai_usage_org_idx', columns: ['organizationId', 'createdAt'] },
    { name: 'ai_usage_conversation_idx', columns: ['conversationId'] }
  ]
};

export const runtimeAiTables: TableDefinition[] = [
  vfsCrdtOpsTable,
  ...runtimeAiMlsTables,
  aiConversationsTable,
  aiMessagesTable,
  aiUsageTable
];
