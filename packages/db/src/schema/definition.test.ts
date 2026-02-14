import { describe, expect, it } from 'vitest';
import {
  albumsTable,
  allTables,
  analyticsEventsTable,
  contactEmailsTable,
  contactGroupsTable,
  contactPhonesTable,
  contactsTable,
  emailFoldersTable,
  emailsTable,
  filesTable,
  groupsTable,
  healthBloodPressureReadingsTable,
  healthExercisesTable,
  healthWeightReadingsTable,
  healthWorkoutEntriesTable,
  migrationsTable,
  mlsGroupMembersTable,
  mlsGroupStateTable,
  mlsGroupsTable,
  mlsKeyPackagesTable,
  mlsMessagesTable,
  mlsWelcomeMessagesTable,
  notesTable,
  organizationBillingAccountsTable,
  organizationsTable,
  orgSharesTable,
  playlistsTable,
  revenuecatWebhookEventsTable,
  secretsTable,
  syncMetadataTable,
  tagsTable,
  userCredentialsTable,
  userGroupsTable,
  userKeysTable,
  userOrganizationsTable,
  userSettingsTable,
  usersTable,
  vehiclesTable,
  vfsAccessTable,
  vfsAclEntriesTable,
  vfsBlobObjectsTable,
  vfsBlobRefsTable,
  vfsBlobStagingTable,
  vfsCrdtOpsTable,
  vfsFoldersTable,
  vfsLinksTable,
  vfsRegistryTable,
  vfsSharesTable,
  vfsSyncChangesTable,
  vfsSyncClientStateTable
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
    expect(syncMetadataTable.columns['id']).toBeDefined();
    expect(syncMetadataTable.columns['entityType']).toBeDefined();
    expect(syncMetadataTable.columns['entityId']).toBeDefined();
    expect(syncMetadataTable.columns['version']).toBeDefined();
    expect(syncMetadataTable.columns['lastModified']).toBeDefined();
    expect(syncMetadataTable.columns['syncStatus']).toBeDefined();
    expect(syncMetadataTable.columns['deleted']).toBeDefined();
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
    expect(userSettingsTable.columns['key']).toBeDefined();
    expect(userSettingsTable.columns['value']).toBeDefined();
    expect(userSettingsTable.columns['updatedAt']).toBeDefined();
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
    expect(usersTable.columns['id']).toBeDefined();
    expect(usersTable.columns['email']).toBeDefined();
    expect(usersTable.columns['emailConfirmed']).toBeDefined();
    expect(usersTable.columns['admin']).toBeDefined();
    expect(usersTable.columns['personalOrganizationId']).toBeDefined();
  });
});

describe('organizationsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(organizationsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(organizationsTable.name).toBe('organizations');
    expect(organizationsTable.propertyName).toBe('organizations');
  });

  it('has required columns', () => {
    expect(organizationsTable.columns['id']).toBeDefined();
    expect(organizationsTable.columns['name']).toBeDefined();
    expect(organizationsTable.columns['description']).toBeDefined();
    expect(organizationsTable.columns['isPersonal']).toBeDefined();
    expect(organizationsTable.columns['createdAt']).toBeDefined();
    expect(organizationsTable.columns['updatedAt']).toBeDefined();
  });
});

describe('userOrganizationsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(userOrganizationsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(userOrganizationsTable.name).toBe('user_organizations');
    expect(userOrganizationsTable.propertyName).toBe('userOrganizations');
  });

  it('has required columns', () => {
    expect(userOrganizationsTable.columns['userId']).toBeDefined();
    expect(userOrganizationsTable.columns['organizationId']).toBeDefined();
    expect(userOrganizationsTable.columns['joinedAt']).toBeDefined();
  });
});

describe('organizationBillingAccountsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(organizationBillingAccountsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(organizationBillingAccountsTable.name).toBe(
      'organization_billing_accounts'
    );
    expect(organizationBillingAccountsTable.propertyName).toBe(
      'organizationBillingAccounts'
    );
  });

  it('has required columns', () => {
    expect(
      organizationBillingAccountsTable.columns['organizationId']
    ).toBeDefined();
    expect(
      organizationBillingAccountsTable.columns['revenuecatAppUserId']
    ).toBeDefined();
    expect(
      organizationBillingAccountsTable.columns['entitlementStatus']
    ).toBeDefined();
    expect(organizationBillingAccountsTable.columns['createdAt']).toBeDefined();
    expect(organizationBillingAccountsTable.columns['updatedAt']).toBeDefined();
  });
});

describe('revenuecatWebhookEventsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(revenuecatWebhookEventsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(revenuecatWebhookEventsTable.name).toBe('revenuecat_webhook_events');
    expect(revenuecatWebhookEventsTable.propertyName).toBe(
      'revenuecatWebhookEvents'
    );
  });

  it('has required columns', () => {
    expect(revenuecatWebhookEventsTable.columns['id']).toBeDefined();
    expect(revenuecatWebhookEventsTable.columns['eventId']).toBeDefined();
    expect(revenuecatWebhookEventsTable.columns['eventType']).toBeDefined();
    expect(revenuecatWebhookEventsTable.columns['payload']).toBeDefined();
    expect(revenuecatWebhookEventsTable.columns['receivedAt']).toBeDefined();
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
    expect(userCredentialsTable.columns['userId']).toBeDefined();
    expect(userCredentialsTable.columns['passwordHash']).toBeDefined();
    expect(userCredentialsTable.columns['passwordSalt']).toBeDefined();
    expect(userCredentialsTable.columns['createdAt']).toBeDefined();
    expect(userCredentialsTable.columns['updatedAt']).toBeDefined();
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
    expect(migrationsTable.columns['version']).toBeDefined();
    expect(migrationsTable.columns['appliedAt']).toBeDefined();
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
    expect(secretsTable.columns['key']).toBeDefined();
    expect(secretsTable.columns['encryptedValue']).toBeDefined();
    expect(secretsTable.columns['createdAt']).toBeDefined();
    expect(secretsTable.columns['updatedAt']).toBeDefined();
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
    expect(filesTable.columns['id']).toBeDefined();
    expect(filesTable.columns['name']).toBeDefined();
    expect(filesTable.columns['size']).toBeDefined();
    expect(filesTable.columns['mimeType']).toBeDefined();
    expect(filesTable.columns['uploadDate']).toBeDefined();
    expect(filesTable.columns['contentHash']).toBeDefined();
    expect(filesTable.columns['storagePath']).toBeDefined();
    expect(filesTable.columns['thumbnailPath']).toBeDefined();
    expect(filesTable.columns['deleted']).toBeDefined();
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
    expect(contactsTable.columns['id']).toBeDefined();
    expect(contactsTable.columns['firstName']).toBeDefined();
    expect(contactsTable.columns['lastName']).toBeDefined();
    expect(contactsTable.columns['birthday']).toBeDefined();
    expect(contactsTable.columns['createdAt']).toBeDefined();
    expect(contactsTable.columns['updatedAt']).toBeDefined();
    expect(contactsTable.columns['deleted']).toBeDefined();
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
    expect(contactPhonesTable.columns['id']).toBeDefined();
    expect(contactPhonesTable.columns['contactId']).toBeDefined();
    expect(contactPhonesTable.columns['phoneNumber']).toBeDefined();
    expect(contactPhonesTable.columns['label']).toBeDefined();
    expect(contactPhonesTable.columns['isPrimary']).toBeDefined();
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
    expect(contactEmailsTable.columns['id']).toBeDefined();
    expect(contactEmailsTable.columns['contactId']).toBeDefined();
    expect(contactEmailsTable.columns['email']).toBeDefined();
    expect(contactEmailsTable.columns['label']).toBeDefined();
    expect(contactEmailsTable.columns['isPrimary']).toBeDefined();
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
    expect(analyticsEventsTable.columns['id']).toBeDefined();
    expect(analyticsEventsTable.columns['eventName']).toBeDefined();
    expect(analyticsEventsTable.columns['durationMs']).toBeDefined();
    expect(analyticsEventsTable.columns['success']).toBeDefined();
    expect(analyticsEventsTable.columns['timestamp']).toBeDefined();
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
    expect(notesTable.columns['id']).toBeDefined();
    expect(notesTable.columns['title']).toBeDefined();
    expect(notesTable.columns['content']).toBeDefined();
    expect(notesTable.columns['createdAt']).toBeDefined();
    expect(notesTable.columns['updatedAt']).toBeDefined();
    expect(notesTable.columns['deleted']).toBeDefined();
  });

  it('has indexes', () => {
    expect(notesTable.indexes).toHaveLength(2);
    expect(notesTable.indexes?.[0]?.name).toBe('notes_updated_at_idx');
    expect(notesTable.indexes?.[1]?.name).toBe('notes_title_idx');
  });
});

describe('vehiclesTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(vehiclesTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(vehiclesTable.name).toBe('vehicles');
    expect(vehiclesTable.propertyName).toBe('vehicles');
  });

  it('has required columns', () => {
    expect(vehiclesTable.columns['id']).toBeDefined();
    expect(vehiclesTable.columns['make']).toBeDefined();
    expect(vehiclesTable.columns['model']).toBeDefined();
    expect(vehiclesTable.columns['year']).toBeDefined();
    expect(vehiclesTable.columns['color']).toBeDefined();
    expect(vehiclesTable.columns['createdAt']).toBeDefined();
    expect(vehiclesTable.columns['updatedAt']).toBeDefined();
    expect(vehiclesTable.columns['deleted']).toBeDefined();
  });

  it('has indexes', () => {
    expect(vehiclesTable.indexes).toHaveLength(4);
    expect(vehiclesTable.indexes?.[0]?.name).toBe('vehicles_updated_at_idx');
    expect(vehiclesTable.indexes?.[1]?.name).toBe('vehicles_make_model_idx');
    expect(vehiclesTable.indexes?.[2]?.name).toBe('vehicles_year_idx');
    expect(vehiclesTable.indexes?.[3]?.name).toBe('vehicles_deleted_idx');
  });
});

describe('healthExercisesTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(healthExercisesTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(healthExercisesTable.name).toBe('health_exercises');
    expect(healthExercisesTable.propertyName).toBe('healthExercises');
  });

  it('has required columns', () => {
    expect(healthExercisesTable.columns['id']).toBeDefined();
    expect(healthExercisesTable.columns['name']).toBeDefined();
    expect(healthExercisesTable.columns['createdAt']).toBeDefined();
  });
});

describe('healthWeightReadingsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(healthWeightReadingsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(healthWeightReadingsTable.name).toBe('health_weight_readings');
    expect(healthWeightReadingsTable.propertyName).toBe('healthWeightReadings');
  });

  it('has required columns', () => {
    expect(healthWeightReadingsTable.columns['id']).toBeDefined();
    expect(healthWeightReadingsTable.columns['recordedAt']).toBeDefined();
    expect(healthWeightReadingsTable.columns['valueCenti']).toBeDefined();
    expect(healthWeightReadingsTable.columns['unit']).toBeDefined();
    expect(healthWeightReadingsTable.columns['createdAt']).toBeDefined();
  });
});

describe('healthBloodPressureReadingsTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(healthBloodPressureReadingsTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(healthBloodPressureReadingsTable.name).toBe(
      'health_blood_pressure_readings'
    );
    expect(healthBloodPressureReadingsTable.propertyName).toBe(
      'healthBloodPressureReadings'
    );
  });

  it('has required columns', () => {
    expect(healthBloodPressureReadingsTable.columns['id']).toBeDefined();
    expect(
      healthBloodPressureReadingsTable.columns['recordedAt']
    ).toBeDefined();
    expect(healthBloodPressureReadingsTable.columns['systolic']).toBeDefined();
    expect(healthBloodPressureReadingsTable.columns['diastolic']).toBeDefined();
    expect(healthBloodPressureReadingsTable.columns['createdAt']).toBeDefined();
  });
});

describe('healthWorkoutEntriesTable', () => {
  it('is a valid table definition', () => {
    expect(isTableDefinition(healthWorkoutEntriesTable)).toBe(true);
  });

  it('has correct table name and property name', () => {
    expect(healthWorkoutEntriesTable.name).toBe('health_workout_entries');
    expect(healthWorkoutEntriesTable.propertyName).toBe('healthWorkoutEntries');
  });

  it('has required columns', () => {
    expect(healthWorkoutEntriesTable.columns['id']).toBeDefined();
    expect(healthWorkoutEntriesTable.columns['performedAt']).toBeDefined();
    expect(healthWorkoutEntriesTable.columns['exerciseId']).toBeDefined();
    expect(healthWorkoutEntriesTable.columns['reps']).toBeDefined();
    expect(healthWorkoutEntriesTable.columns['weightCenti']).toBeDefined();
    expect(healthWorkoutEntriesTable.columns['weightUnit']).toBeDefined();
    expect(healthWorkoutEntriesTable.columns['createdAt']).toBeDefined();
  });
});

describe('tagsTable', () => {
  it('has soft-delete column', () => {
    expect(tagsTable.columns['deleted']).toBeDefined();
  });
});

describe('vfsAclEntriesTable', () => {
  it('uses flattened principal ACL columns', () => {
    expect(vfsAclEntriesTable.columns['principalType']).toBeDefined();
    expect(vfsAclEntriesTable.columns['principalId']).toBeDefined();
    expect(vfsAclEntriesTable.columns['accessLevel']).toBeDefined();
    expect(vfsAclEntriesTable.columns['revokedAt']).toBeDefined();
  });
});

describe('vfsSyncChangesTable', () => {
  it('has change feed cursor columns', () => {
    expect(vfsSyncChangesTable.columns['itemId']).toBeDefined();
    expect(vfsSyncChangesTable.columns['changeType']).toBeDefined();
    expect(vfsSyncChangesTable.columns['changedAt']).toBeDefined();
    expect(vfsSyncChangesTable.columns['rootId']).toBeDefined();
  });
});

describe('vfsSyncClientStateTable', () => {
  it('tracks per-client reconcile cursors', () => {
    expect(vfsSyncClientStateTable.columns['userId']).toBeDefined();
    expect(vfsSyncClientStateTable.columns['clientId']).toBeDefined();
    expect(vfsSyncClientStateTable.columns['lastReconciledAt']).toBeDefined();
    expect(
      vfsSyncClientStateTable.columns['lastReconciledChangeId']
    ).toBeDefined();
  });
});

describe('vfsBlobObjectsTable', () => {
  it('tracks immutable blob metadata', () => {
    expect(vfsBlobObjectsTable.columns['id']).toBeDefined();
    expect(vfsBlobObjectsTable.columns['sha256']).toBeDefined();
    expect(vfsBlobObjectsTable.columns['sizeBytes']).toBeDefined();
    expect(vfsBlobObjectsTable.columns['storageKey']).toBeDefined();
    expect(vfsBlobObjectsTable.columns['createdBy']).toBeDefined();
  });
});

describe('vfsBlobStagingTable', () => {
  it('supports staged-to-attached lifecycle', () => {
    expect(vfsBlobStagingTable.columns['blobId']).toBeDefined();
    expect(vfsBlobStagingTable.columns['status']).toBeDefined();
    expect(vfsBlobStagingTable.columns['expiresAt']).toBeDefined();
    expect(vfsBlobStagingTable.columns['attachedItemId']).toBeDefined();
  });
});

describe('vfsBlobRefsTable', () => {
  it('links blobs to vfs items', () => {
    expect(vfsBlobRefsTable.columns['blobId']).toBeDefined();
    expect(vfsBlobRefsTable.columns['itemId']).toBeDefined();
    expect(vfsBlobRefsTable.columns['relationKind']).toBeDefined();
    expect(vfsBlobRefsTable.columns['attachedBy']).toBeDefined();
  });
});

describe('vfsCrdtOpsTable', () => {
  it('stores acl and link operation logs', () => {
    expect(vfsCrdtOpsTable.columns['itemId']).toBeDefined();
    expect(vfsCrdtOpsTable.columns['opType']).toBeDefined();
    expect(vfsCrdtOpsTable.columns['principalType']).toBeDefined();
    expect(vfsCrdtOpsTable.columns['parentId']).toBeDefined();
    expect(vfsCrdtOpsTable.columns['childId']).toBeDefined();
    expect(vfsCrdtOpsTable.columns['occurredAt']).toBeDefined();
  });
});

describe('allTables', () => {
  it('contains all canonical tables', () => {
    expect(allTables).toHaveLength(54);
  });

  it('contains all table definitions', () => {
    expect(allTables).toContain(syncMetadataTable);
    expect(allTables).toContain(userSettingsTable);
    expect(allTables).toContain(usersTable);
    expect(allTables).toContain(organizationsTable);
    expect(allTables).toContain(userOrganizationsTable);
    expect(allTables).toContain(organizationBillingAccountsTable);
    expect(allTables).toContain(revenuecatWebhookEventsTable);
    expect(allTables).toContain(userCredentialsTable);
    expect(allTables).toContain(migrationsTable);
    expect(allTables).toContain(secretsTable);
    expect(allTables).toContain(filesTable);
    expect(allTables).toContain(contactsTable);
    expect(allTables).toContain(contactPhonesTable);
    expect(allTables).toContain(contactEmailsTable);
    expect(allTables).toContain(analyticsEventsTable);
    expect(allTables).toContain(notesTable);
    expect(allTables).toContain(vehiclesTable);
    expect(allTables).toContain(healthExercisesTable);
    expect(allTables).toContain(healthWeightReadingsTable);
    expect(allTables).toContain(healthBloodPressureReadingsTable);
    expect(allTables).toContain(healthWorkoutEntriesTable);
    expect(allTables).toContain(groupsTable);
    expect(allTables).toContain(userGroupsTable);
    expect(allTables).toContain(userKeysTable);
    expect(allTables).toContain(vfsRegistryTable);
    expect(allTables).toContain(vfsFoldersTable);
    expect(allTables).toContain(vfsLinksTable);
    expect(allTables).toContain(playlistsTable);
    expect(allTables).toContain(albumsTable);
    expect(allTables).toContain(contactGroupsTable);
    expect(allTables).toContain(emailFoldersTable);
    expect(allTables).toContain(tagsTable);
    expect(allTables).toContain(emailsTable);
    expect(allTables).toContain(vfsSharesTable);
    expect(allTables).toContain(orgSharesTable);
    expect(allTables).toContain(vfsAccessTable);
    expect(allTables).toContain(vfsAclEntriesTable);
    expect(allTables).toContain(vfsSyncChangesTable);
    expect(allTables).toContain(vfsSyncClientStateTable);
    expect(allTables).toContain(vfsBlobObjectsTable);
    expect(allTables).not.toContain(vfsBlobStagingTable);
    expect(allTables).not.toContain(vfsBlobRefsTable);
    expect(allTables).toContain(vfsCrdtOpsTable);
    expect(allTables).toContain(mlsKeyPackagesTable);
    expect(allTables).toContain(mlsGroupsTable);
    expect(allTables).toContain(mlsGroupMembersTable);
    expect(allTables).toContain(mlsMessagesTable);
    expect(allTables).toContain(mlsWelcomeMessagesTable);
    expect(allTables).toContain(mlsGroupStateTable);
  });

  it('all tables are valid definitions', () => {
    for (const table of allTables) {
      expect(isTableDefinition(table)).toBe(true);
    }
  });
});
