import type { TableDefinition } from './types.js';

/**
 * Policy headers for container-scoped sharing rules.
 * A policy defines the container root and global lifecycle metadata.
 */
export const vfsSharePoliciesTable: TableDefinition = {
  name: 'vfs_share_policies',
  propertyName: 'vfsSharePolicies',
  comment:
    'Policy headers for container-scoped sharing rules.\nDefines root scope and lifecycle metadata for share-policy compilation.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    rootItemId: {
      type: 'text',
      sqlName: 'root_item_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    status: {
      type: 'text',
      sqlName: 'status',
      notNull: true,
      enumValues: ['draft', 'active', 'paused', 'revoked'] as const,
      defaultValue: 'draft'
    },
    name: {
      type: 'text',
      sqlName: 'name'
    },
    createdBy: {
      type: 'text',
      sqlName: 'created_by',
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'set null'
      }
    },
    schemaVersion: {
      type: 'integer',
      sqlName: 'schema_version',
      notNull: true,
      defaultValue: 1
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
    expiresAt: {
      type: 'timestamp',
      sqlName: 'expires_at'
    },
    revokedAt: {
      type: 'timestamp',
      sqlName: 'revoked_at'
    }
  },
  indexes: [
    { name: 'vfs_share_policies_root_idx', columns: ['rootItemId'] },
    { name: 'vfs_share_policies_status_idx', columns: ['status'] },
    { name: 'vfs_share_policies_created_by_idx', columns: ['createdBy'] }
  ]
};

/**
 * Include/exclude selectors for share policies.
 * Selectors define how descendant expansion is constrained.
 */
export const vfsSharePolicySelectorsTable: TableDefinition = {
  name: 'vfs_share_policy_selectors',
  propertyName: 'vfsSharePolicySelectors',
  comment:
    'Selectors for share policies.\nSupports include/exclude rules, depth constraints, and object-type filters.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    policyId: {
      type: 'text',
      sqlName: 'policy_id',
      notNull: true,
      references: {
        table: 'vfs_share_policies',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    selectorKind: {
      type: 'text',
      sqlName: 'selector_kind',
      notNull: true,
      enumValues: ['include', 'exclude'] as const
    },
    matchMode: {
      type: 'text',
      sqlName: 'match_mode',
      notNull: true,
      enumValues: ['subtree', 'children', 'exact'] as const,
      defaultValue: 'subtree'
    },
    anchorItemId: {
      type: 'text',
      sqlName: 'anchor_item_id',
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    },
    maxDepth: {
      type: 'integer',
      sqlName: 'max_depth'
    },
    includeRoot: {
      type: 'boolean',
      sqlName: 'include_root',
      notNull: true,
      defaultValue: true
    },
    objectTypes: {
      type: 'json',
      sqlName: 'object_types'
    },
    selectorOrder: {
      type: 'integer',
      sqlName: 'selector_order',
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
  indexes: [
    { name: 'vfs_share_policy_selectors_policy_idx', columns: ['policyId'] },
    {
      name: 'vfs_share_policy_selectors_anchor_idx',
      columns: ['anchorItemId']
    },
    {
      name: 'vfs_share_policy_selectors_policy_order_idx',
      columns: ['policyId', 'selectorOrder'],
      unique: true
    }
  ]
};

/**
 * Principal targets attached to a share policy.
 */
export const vfsSharePolicyPrincipalsTable: TableDefinition = {
  name: 'vfs_share_policy_principals',
  propertyName: 'vfsSharePolicyPrincipals',
  comment:
    'Principal targets for share policies.\nMaps policy headers to user/group/organization grants.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    policyId: {
      type: 'text',
      sqlName: 'policy_id',
      notNull: true,
      references: {
        table: 'vfs_share_policies',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    principalType: {
      type: 'text',
      sqlName: 'principal_type',
      notNull: true,
      enumValues: ['user', 'group', 'organization'] as const
    },
    principalId: {
      type: 'text',
      sqlName: 'principal_id',
      notNull: true
    },
    accessLevel: {
      type: 'text',
      sqlName: 'access_level',
      notNull: true,
      enumValues: ['read', 'write', 'admin'] as const
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
  indexes: [
    { name: 'vfs_share_policy_principals_policy_idx', columns: ['policyId'] },
    {
      name: 'vfs_share_policy_principals_target_idx',
      columns: ['principalType', 'principalId']
    },
    {
      name: 'vfs_share_policy_principals_unique_idx',
      columns: ['policyId', 'principalType', 'principalId'],
      unique: true
    }
  ]
};

/**
 * Provenance metadata for effective ACL rows.
 * Tracks whether ACL materialization is direct or policy-derived.
 */
export const vfsAclEntryProvenanceTable: TableDefinition = {
  name: 'vfs_acl_entry_provenance',
  propertyName: 'vfsAclEntryProvenance',
  comment:
    'Provenance metadata for effective ACL rows.\nTracks direct-vs-policy derived decisions and compiler run attribution.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    aclEntryId: {
      type: 'text',
      sqlName: 'acl_entry_id',
      notNull: true,
      references: {
        table: 'vfs_acl_entries',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    provenanceType: {
      type: 'text',
      sqlName: 'provenance_type',
      notNull: true,
      enumValues: ['direct', 'derivedPolicy'] as const
    },
    policyId: {
      type: 'text',
      sqlName: 'policy_id',
      references: {
        table: 'vfs_share_policies',
        column: 'id',
        onDelete: 'set null'
      }
    },
    selectorId: {
      type: 'text',
      sqlName: 'selector_id',
      references: {
        table: 'vfs_share_policy_selectors',
        column: 'id',
        onDelete: 'set null'
      }
    },
    decision: {
      type: 'text',
      sqlName: 'decision',
      notNull: true,
      enumValues: ['allow', 'deny'] as const,
      defaultValue: 'allow'
    },
    precedence: {
      type: 'integer',
      sqlName: 'precedence',
      notNull: true,
      defaultValue: 0
    },
    compiledAt: {
      type: 'timestamp',
      sqlName: 'compiled_at'
    },
    compilerRunId: {
      type: 'text',
      sqlName: 'compiler_run_id'
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
  indexes: [
    {
      name: 'vfs_acl_entry_provenance_acl_entry_idx',
      columns: ['aclEntryId']
    },
    {
      name: 'vfs_acl_entry_provenance_policy_idx',
      columns: ['policyId']
    },
    {
      name: 'vfs_acl_entry_provenance_selector_idx',
      columns: ['selectorId']
    },
    {
      name: 'vfs_acl_entry_provenance_source_idx',
      columns: ['provenanceType', 'policyId', 'selectorId']
    }
  ]
};

export const communicationsVfsPolicyTables: TableDefinition[] = [
  vfsSharePoliciesTable,
  vfsSharePolicySelectorsTable,
  vfsSharePolicyPrincipalsTable,
  vfsAclEntryProvenanceTable
];
