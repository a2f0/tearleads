import { describe, expect, it } from 'vitest';
import {
  allTables,
  analyticsEventsTable,
  contactEmailsTable,
  contactPhonesTable,
  contactsTable,
  filesTable,
  migrationsTable,
  notesTable,
  secretsTable,
  syncMetadataTable,
  userCredentialsTable,
  userSettingsTable,
  usersTable
} from './definition.js';
import { isTableDefinition } from './types.js';

describe('syncMetadataTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(syncMetadataTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(syncMetadataTable.name).toBe('sync_metadata');
    expect(syncMetadataTable.propertyName).toBe('syncMetadata');
  });

  it('has required columns', () => {
    expect(syncMetadataTable.columns.id).toBeDefined();
    expect(syncMetadataTable.columns.entityType).toBeDefined();
    expect(syncMetadataTable.columns.entityId).toBeDefined();
    expect(syncMetadataTable.columns.version).toBeDefined();
    expect(syncMetadataTable.columns.lastModified).toBeDefined();
    expect(syncMetadataTable.columns.syncStatus).toBeDefined();
    expect(syncMetadataTable.columns.deleted).toBeDefined();
  });

  it('has indexes', () => {
    expect(syncMetadataTable.indexes).toHaveLength(2);
    expect(syncMetadataTable.indexes?.[0]?.name).toBe('entity_idx');
    expect(syncMetadataTable.indexes?.[1]?.name).toBe('sync_status_idx');
  });
});

describe('userSettingsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(userSettingsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(userSettingsTable.name).toBe('user_settings');
    expect(userSettingsTable.propertyName).toBe('userSettings');
  });

  it('has required columns', () => {
    expect(userSettingsTable.columns.key).toBeDefined();
    expect(userSettingsTable.columns.value).toBeDefined();
    expect(userSettingsTable.columns.updatedAt).toBeDefined();
  });
});

describe('usersTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(usersTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(usersTable.name).toBe('users');
    expect(usersTable.propertyName).toBe('users');
  });

  it('has required columns', () => {
    expect(usersTable.columns.id).toBeDefined();
    expect(usersTable.columns.email).toBeDefined();
    expect(usersTable.columns.emailConfirmed).toBeDefined();
  });
});

describe('userCredentialsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(userCredentialsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(userCredentialsTable.name).toBe('user_credentials');
    expect(userCredentialsTable.propertyName).toBe('userCredentials');
  });

  it('has required columns', () => {
    expect(userCredentialsTable.columns.userId).toBeDefined();
    expect(userCredentialsTable.columns.passwordHash).toBeDefined();
    expect(userCredentialsTable.columns.passwordSalt).toBeDefined();
    expect(userCredentialsTable.columns.createdAt).toBeDefined();
    expect(userCredentialsTable.columns.updatedAt).toBeDefined();
  });
});

describe('migrationsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(migrationsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(migrationsTable.name).toBe('schema_migrations');
    expect(migrationsTable.propertyName).toBe('migrations');
  });

  it('has required columns', () => {
    expect(migrationsTable.columns.version).toBeDefined();
    expect(migrationsTable.columns.appliedAt).toBeDefined();
  });
});

describe('secretsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(secretsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(secretsTable.name).toBe('secrets');
    expect(secretsTable.propertyName).toBe('secrets');
  });

  it('has required columns', () => {
    expect(secretsTable.columns.key).toBeDefined();
    expect(secretsTable.columns.encryptedValue).toBeDefined();
    expect(secretsTable.columns.createdAt).toBeDefined();
    expect(secretsTable.columns.updatedAt).toBeDefined();
  });
});

describe('filesTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(filesTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(filesTable.name).toBe('files');
    expect(filesTable.propertyName).toBe('files');
  });

  it('has required columns', () => {
    expect(filesTable.columns.id).toBeDefined();
    expect(filesTable.columns.name).toBeDefined();
    expect(filesTable.columns.size).toBeDefined();
    expect(filesTable.columns.mimeType).toBeDefined();
    expect(filesTable.columns.uploadDate).toBeDefined();
    expect(filesTable.columns.contentHash).toBeDefined();
    expect(filesTable.columns.storagePath).toBeDefined();
    expect(filesTable.columns.thumbnailPath).toBeDefined();
    expect(filesTable.columns.deleted).toBeDefined();
  });

  it('has indexes', () => {
    expect(filesTable.indexes).toHaveLength(2);
    expect(filesTable.indexes?.[0]?.name).toBe('files_content_hash_idx');
    expect(filesTable.indexes?.[1]?.name).toBe('files_upload_date_idx');
  });
});

describe('contactsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(contactsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(contactsTable.name).toBe('contacts');
    expect(contactsTable.propertyName).toBe('contacts');
  });

  it('has required columns', () => {
    expect(contactsTable.columns.id).toBeDefined();
    expect(contactsTable.columns.firstName).toBeDefined();
    expect(contactsTable.columns.lastName).toBeDefined();
    expect(contactsTable.columns.birthday).toBeDefined();
    expect(contactsTable.columns.createdAt).toBeDefined();
    expect(contactsTable.columns.updatedAt).toBeDefined();
    expect(contactsTable.columns.deleted).toBeDefined();
  });

  it('has indexes', () => {
    expect(contactsTable.indexes).toHaveLength(1);
    expect(contactsTable.indexes?.[0]?.name).toBe('contacts_first_name_idx');
  });
});

describe('contactPhonesTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(contactPhonesTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(contactPhonesTable.name).toBe('contact_phones');
    expect(contactPhonesTable.propertyName).toBe('contactPhones');
  });

  it('has required columns', () => {
    expect(contactPhonesTable.columns.id).toBeDefined();
    expect(contactPhonesTable.columns.contactId).toBeDefined();
    expect(contactPhonesTable.columns.phoneNumber).toBeDefined();
    expect(contactPhonesTable.columns.label).toBeDefined();
    expect(contactPhonesTable.columns.isPrimary).toBeDefined();
  });

  it('has indexes', () => {
    expect(contactPhonesTable.indexes).toHaveLength(1);
    expect(contactPhonesTable.indexes?.[0]?.name).toBe(
      'contact_phones_contact_idx'
    );
  });
});

describe('contactEmailsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(contactEmailsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(contactEmailsTable.name).toBe('contact_emails');
    expect(contactEmailsTable.propertyName).toBe('contactEmails');
  });

  it('has required columns', () => {
    expect(contactEmailsTable.columns.id).toBeDefined();
    expect(contactEmailsTable.columns.contactId).toBeDefined();
    expect(contactEmailsTable.columns.email).toBeDefined();
    expect(contactEmailsTable.columns.label).toBeDefined();
    expect(contactEmailsTable.columns.isPrimary).toBeDefined();
  });

  it('has indexes', () => {
    expect(contactEmailsTable.indexes).toHaveLength(2);
    expect(contactEmailsTable.indexes?.[0]?.name).toBe(
      'contact_emails_contact_idx'
    );
    expect(contactEmailsTable.indexes?.[1]?.name).toBe(
      'contact_emails_email_idx'
    );
  });
});

describe('analyticsEventsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(analyticsEventsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(analyticsEventsTable.name).toBe('analytics_events');
    expect(analyticsEventsTable.propertyName).toBe('analyticsEvents');
  });

  it('has required columns', () => {
    expect(analyticsEventsTable.columns.id).toBeDefined();
    expect(analyticsEventsTable.columns.eventName).toBeDefined();
    expect(analyticsEventsTable.columns.durationMs).toBeDefined();
    expect(analyticsEventsTable.columns.success).toBeDefined();
    expect(analyticsEventsTable.columns.timestamp).toBeDefined();
  });

  it('has indexes', () => {
    expect(analyticsEventsTable.indexes).toHaveLength(1);
    expect(analyticsEventsTable.indexes?.[0]?.name).toBe(
      'analytics_events_timestamp_idx'
    );
  });
});

describe('notesTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(notesTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(notesTable.name).toBe('notes');
    expect(notesTable.propertyName).toBe('notes');
  });

  it('has required columns', () => {
    expect(notesTable.columns.id).toBeDefined();
    expect(notesTable.columns.title).toBeDefined();
    expect(notesTable.columns.content).toBeDefined();
    expect(notesTable.columns.createdAt).toBeDefined();
    expect(notesTable.columns.updatedAt).toBeDefined();
    expect(notesTable.columns.deleted).toBeDefined();
  });

  it('has indexes', () => {
    expect(notesTable.indexes).toHaveLength(2);
    expect(notesTable.indexes?.[0]?.name).toBe('notes_updated_at_idx');
    expect(notesTable.indexes?.[1]?.name).toBe('notes_title_idx');
  });
});

describe('allTables', () => {
  it('contains all 12 tables', () => {
    expect(allTables).toHaveLength(12);
  });

  it('contains all table definitions', () => {
    expect(allTables).toContain(syncMetadataTable);
    expect(allTables).toContain(userSettingsTable);
    expect(allTables).toContain(usersTable);
    expect(allTables).toContain(userCredentialsTable);
    expect(allTables).toContain(migrationsTable);
    expect(allTables).toContain(secretsTable);
    expect(allTables).toContain(filesTable);
    expect(allTables).toContain(contactsTable);
    expect(allTables).toContain(contactPhonesTable);
    expect(allTables).toContain(contactEmailsTable);
    expect(allTables).toContain(analyticsEventsTable);
    expect(allTables).toContain(notesTable);
  });

  it('all tables are valid definitions', () => {
    for (const table of allTables) {
      expect(isTableDefinition(table)).toBe(true);
    }
  });
});
