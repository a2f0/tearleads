import type { TableDefinition } from './types.js';

/**
 * Contacts table for storing contact information.
 */
export const contactsTable: TableDefinition = {
  name: 'contacts',
  propertyName: 'contacts',
  comment: 'Contacts table for storing contact information.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    firstName: {
      type: 'text',
      sqlName: 'first_name',
      notNull: true
    },
    lastName: {
      type: 'text',
      sqlName: 'last_name'
    },
    birthday: {
      type: 'text',
      sqlName: 'birthday'
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
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id'
    }
  },
  indexes: [
    { name: 'contacts_first_name_idx', columns: ['firstName'] },
    { name: 'contacts_org_idx', columns: ['organizationId'] }
  ]
};

/**
 * Contact phone numbers (multiple per contact).
 */
export const contactPhonesTable: TableDefinition = {
  name: 'contact_phones',
  propertyName: 'contactPhones',
  comment: 'Contact phone numbers (multiple per contact).',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    contactId: {
      type: 'text',
      sqlName: 'contact_id',
      notNull: true,
      references: {
        table: 'contacts',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    phoneNumber: {
      type: 'text',
      sqlName: 'phone_number',
      notNull: true
    },
    label: {
      type: 'text',
      sqlName: 'label'
    },
    isPrimary: {
      type: 'boolean',
      sqlName: 'is_primary',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'contact_phones_contact_idx', columns: ['contactId'] }]
};

/**
 * Contact email addresses (multiple per contact).
 */
export const contactEmailsTable: TableDefinition = {
  name: 'contact_emails',
  propertyName: 'contactEmails',
  comment: 'Contact email addresses (multiple per contact).',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    contactId: {
      type: 'text',
      sqlName: 'contact_id',
      notNull: true,
      references: {
        table: 'contacts',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    email: {
      type: 'text',
      sqlName: 'email',
      notNull: true
    },
    label: {
      type: 'text',
      sqlName: 'label'
    },
    isPrimary: {
      type: 'boolean',
      sqlName: 'is_primary',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [
    { name: 'contact_emails_contact_idx', columns: ['contactId'] },
    { name: 'contact_emails_email_idx', columns: ['email'] }
  ]
};

export const foundationContactsTables: TableDefinition[] = [
  contactsTable,
  contactPhonesTable,
  contactEmailsTable
];
