import type { TableDefinition } from './types.js';

/**
 * AI conversations - extends vfs_registry for conversation-type items.
 * Stores encrypted conversation metadata as a VFS object.
 */
const aiConversationsTable: TableDefinition = {
  name: 'ai_conversations',
  propertyName: 'aiConversations',
  comment:
    'AI conversations - extends vfs_registry for conversation-type items.\nStores encrypted conversation metadata as a VFS object.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedTitle: {
      type: 'text',
      sqlName: 'encrypted_title',
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
    }
  },
  indexes: [{ name: 'ai_conversations_updated_idx', columns: ['updatedAt'] }]
};

/**
 * AI messages - stores encrypted message content.
 * Child table of ai_conversations, not a VFS item itself.
 * Messages are materialized locally from the CRDT encrypted payload.
 */
const aiMessagesTable: TableDefinition = {
  name: 'ai_messages',
  propertyName: 'aiMessages',
  comment:
    'AI messages - stores encrypted message content.\nChild table of ai_conversations, materialized from CRDT payload.',
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

export const communicationsAiTables: TableDefinition[] = [
  aiConversationsTable,
  aiMessagesTable
];
