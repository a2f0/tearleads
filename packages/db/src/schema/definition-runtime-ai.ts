import type { TableDefinition } from './types.js';

// Re-export from split modules
export {
  mlsGroupMembersTable,
  mlsGroupStateTable,
  mlsGroupsTable,
  mlsKeyPackagesTable,
  mlsMessagesTable,
  mlsWelcomeMessagesTable
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
      enumValues: [
        'acl_add',
        'acl_remove',
        'link_add',
        'link_remove',
        'item_upsert',
        'item_delete'
      ] as const
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
    },
    encryptedPayload: {
      type: 'text',
      sqlName: 'encrypted_payload'
    },
    keyEpoch: {
      type: 'integer',
      sqlName: 'key_epoch'
    },
    encryptionNonce: {
      type: 'text',
      sqlName: 'encryption_nonce'
    },
    encryptionAad: {
      type: 'text',
      sqlName: 'encryption_aad'
    },
    encryptionSignature: {
      type: 'text',
      sqlName: 'encryption_signature'
    }
  },
  indexes: [
    { name: 'vfs_crdt_ops_item_idx', columns: ['itemId'] },
    { name: 'vfs_crdt_ops_occurred_idx', columns: ['occurredAt'] },
    { name: 'vfs_crdt_ops_source_idx', columns: ['sourceTable', 'sourceId'] }
  ]
};

// =============================================================================
// AI Usage Table
// =============================================================================
// Usage data (token counts) is stored in plaintext for billing/analytics.
// AI conversations and messages are now VFS objects in definitionCommunicationsAi.ts.

/**
 * AI usage - tracks token usage per request for billing/analytics.
 * Usage data is stored in plaintext (not encrypted) for aggregation.
 */
const aiUsageTable: TableDefinition = {
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
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    },
    messageId: {
      type: 'text',
      sqlName: 'message_id'
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
  aiUsageTable
];
