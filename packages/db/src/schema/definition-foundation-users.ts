import type { TableDefinition } from './types.js';

/**
 * Users table for core identity records.
 */
export const usersTable: TableDefinition = {
  name: 'users',
  propertyName: 'users',
  comment: 'Users table for core identity records.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    email: {
      type: 'text',
      sqlName: 'email',
      notNull: true
    },
    emailConfirmed: {
      type: 'boolean',
      sqlName: 'email_confirmed',
      notNull: true,
      defaultValue: false
    },
    admin: {
      type: 'boolean',
      sqlName: 'admin',
      notNull: true,
      defaultValue: false
    },
    personalOrganizationId: {
      type: 'text',
      sqlName: 'personal_organization_id',
      notNull: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'restrict'
      }
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at'
    },
    updatedAt: {
      type: 'timestamp',
      sqlName: 'updated_at'
    },
    lastActiveAt: {
      type: 'timestamp',
      sqlName: 'last_active_at'
    },
    disabled: {
      type: 'boolean',
      sqlName: 'disabled',
      notNull: true,
      defaultValue: false
    },
    disabledAt: {
      type: 'timestamp',
      sqlName: 'disabled_at'
    },
    disabledBy: {
      type: 'text',
      sqlName: 'disabled_by',
      references: { table: 'users', column: 'id' }
    },
    markedForDeletionAt: {
      type: 'timestamp',
      sqlName: 'marked_for_deletion_at'
    },
    markedForDeletionBy: {
      type: 'text',
      sqlName: 'marked_for_deletion_by',
      references: { table: 'users', column: 'id' }
    }
  },
  indexes: [
    { name: 'users_email_idx', columns: ['email'] },
    {
      name: 'users_personal_organization_id_idx',
      columns: ['personalOrganizationId'],
      unique: true
    }
  ]
};

/**
 * Organizations table for grouping users and groups.
 */
export const organizationsTable: TableDefinition = {
  name: 'organizations',
  propertyName: 'organizations',
  comment: 'Organizations table for grouping users and groups.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    name: {
      type: 'text',
      sqlName: 'name',
      notNull: true
    },
    description: {
      type: 'text',
      sqlName: 'description'
    },
    isPersonal: {
      type: 'boolean',
      sqlName: 'is_personal',
      notNull: true,
      defaultValue: false
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
    { name: 'organizations_name_idx', columns: ['name'], unique: true },
    { name: 'organizations_is_personal_idx', columns: ['isPersonal'] }
  ]
};

/**
 * Junction table for many-to-many relationship between users and organizations.
 */
export const userOrganizationsTable: TableDefinition = {
  name: 'user_organizations',
  propertyName: 'userOrganizations',
  comment:
    'Junction table for many-to-many relationship between users and organizations.',
  columns: {
    userId: {
      type: 'text',
      sqlName: 'user_id',
      primaryKey: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      primaryKey: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    joinedAt: {
      type: 'timestamp',
      sqlName: 'joined_at',
      notNull: true
    },
    isAdmin: {
      type: 'boolean',
      sqlName: 'is_admin',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'user_organizations_org_idx', columns: ['organizationId'] }]
};

/**
 * Organization billing accounts for RevenueCat integration.
 * Stores one billing account record per organization.
 */
// COMPLIANCE_SENTINEL: TL-PAY-005 | control=billing-data-authorization
// COMPLIANCE_SENTINEL: TL-PAY-006 | control=entitlement-state-integrity
export const organizationBillingAccountsTable: TableDefinition = {
  name: 'organization_billing_accounts',
  propertyName: 'organizationBillingAccounts',
  comment:
    'Organization billing accounts for RevenueCat integration.\nStores one billing account record per organization.',
  columns: {
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      primaryKey: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    revenuecatAppUserId: {
      type: 'text',
      sqlName: 'revenuecat_app_user_id',
      notNull: true
    },
    entitlementStatus: {
      type: 'text',
      sqlName: 'entitlement_status',
      notNull: true,
      defaultValue: 'inactive',
      enumValues: [
        'inactive',
        'trialing',
        'active',
        'grace_period',
        'expired'
      ] as const
    },
    activeProductId: {
      type: 'text',
      sqlName: 'active_product_id'
    },
    periodEndsAt: {
      type: 'timestamp',
      sqlName: 'period_ends_at'
    },
    willRenew: {
      type: 'boolean',
      sqlName: 'will_renew'
    },
    lastWebhookEventId: {
      type: 'text',
      sqlName: 'last_webhook_event_id'
    },
    lastWebhookAt: {
      type: 'timestamp',
      sqlName: 'last_webhook_at'
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
      name: 'organization_billing_app_user_idx',
      columns: ['revenuecatAppUserId'],
      unique: true
    },
    {
      name: 'organization_billing_entitlement_idx',
      columns: ['entitlementStatus']
    },
    {
      name: 'organization_billing_period_end_idx',
      columns: ['periodEndsAt']
    }
  ]
};

/**
 * RevenueCat webhook event archive and processing state.
 * Supports idempotent processing by unique event ID.
 */
// COMPLIANCE_SENTINEL: TL-PAY-003 | control=idempotent-event-processing
// COMPLIANCE_SENTINEL: TL-PAY-004 | control=billing-event-audit-trail
export const revenuecatWebhookEventsTable: TableDefinition = {
  name: 'revenuecat_webhook_events',
  propertyName: 'revenuecatWebhookEvents',
  comment:
    'RevenueCat webhook event archive and processing state.\nSupports idempotent processing by unique event ID.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    eventId: {
      type: 'text',
      sqlName: 'event_id',
      notNull: true
    },
    eventType: {
      type: 'text',
      sqlName: 'event_type',
      notNull: true
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
    revenuecatAppUserId: {
      type: 'text',
      sqlName: 'revenuecat_app_user_id',
      notNull: true
    },
    payload: {
      type: 'json',
      sqlName: 'payload',
      notNull: true
    },
    receivedAt: {
      type: 'timestamp',
      sqlName: 'received_at',
      notNull: true
    },
    processedAt: {
      type: 'timestamp',
      sqlName: 'processed_at'
    },
    processingError: {
      type: 'text',
      sqlName: 'processing_error'
    }
  },
  indexes: [
    {
      name: 'revenuecat_events_event_id_idx',
      columns: ['eventId'],
      unique: true
    },
    {
      name: 'revenuecat_events_org_idx',
      columns: ['organizationId']
    },
    {
      name: 'revenuecat_events_app_user_idx',
      columns: ['revenuecatAppUserId']
    },
    {
      name: 'revenuecat_events_received_idx',
      columns: ['receivedAt']
    }
  ]
};

/**
 * User credentials table for password authentication.
 */
export const userCredentialsTable: TableDefinition = {
  name: 'user_credentials',
  propertyName: 'userCredentials',
  comment: 'User credentials table for password authentication.',
  columns: {
    userId: {
      type: 'text',
      sqlName: 'user_id',
      primaryKey: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    passwordHash: {
      type: 'text',
      sqlName: 'password_hash',
      notNull: true
    },
    passwordSalt: {
      type: 'text',
      sqlName: 'password_salt',
      notNull: true
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
  }
};

export const foundationUsersTables: TableDefinition[] = [
  usersTable,
  organizationsTable,
  userOrganizationsTable,
  organizationBillingAccountsTable,
  revenuecatWebhookEventsTable,
  userCredentialsTable
];
