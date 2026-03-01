import { describe, expect, it } from 'vitest';
import {
  albumsTable,
  allTables,
  analyticsEventsTable,
  contactEmailsTable,
  contactGroupsTable,
  contactPhonesTable,
  contactsTable,
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
  playlistsTable,
  postgresRuntimeTables,
  revenuecatWebhookEventsTable,
  secretsTable,
  sqliteRuntimeTables,
  syncMetadataTable,
  tagsTable,
  userCredentialsTable,
  userGroupsTable,
  userKeysTable,
  userOrganizationsTable,
  userSettingsTable,
  usersTable,
  vehiclesTable,
  vfsAclEntriesTable,
  vfsAclEntryProvenanceTable,
  vfsBlobObjectsTable,
  vfsBlobRefsTable,
  vfsBlobStagingTable,
  vfsCrdtOpsTable,
  vfsLinksTable,
  vfsRegistryTable,
  vfsSharePoliciesTable,
  vfsSharePolicyPrincipalsTable,
  vfsSharePolicySelectorsTable,
  vfsSyncChangesTable,
  vfsSyncClientStateTable
} from './definition.js';
import { isTableDefinition } from './types.js';

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

describe('vfsSharePoliciesTable', () => {
  it('stores policy headers and lifecycle state', () => {
    expect(vfsSharePoliciesTable.columns['rootItemId']).toBeDefined();
    expect(vfsSharePoliciesTable.columns['status']).toBeDefined();
    expect(vfsSharePoliciesTable.columns['schemaVersion']).toBeDefined();
    expect(vfsSharePoliciesTable.columns['revokedAt']).toBeDefined();
  });
});

describe('vfsSharePolicySelectorsTable', () => {
  it('stores include/exclude selector metadata', () => {
    expect(vfsSharePolicySelectorsTable.columns['policyId']).toBeDefined();
    expect(vfsSharePolicySelectorsTable.columns['selectorKind']).toBeDefined();
    expect(vfsSharePolicySelectorsTable.columns['matchMode']).toBeDefined();
    expect(vfsSharePolicySelectorsTable.columns['maxDepth']).toBeDefined();
    expect(vfsSharePolicySelectorsTable.columns['objectTypes']).toBeDefined();
  });
});

describe('vfsSharePolicyPrincipalsTable', () => {
  it('maps policies to principal targets', () => {
    expect(vfsSharePolicyPrincipalsTable.columns['policyId']).toBeDefined();
    expect(
      vfsSharePolicyPrincipalsTable.columns['principalType']
    ).toBeDefined();
    expect(vfsSharePolicyPrincipalsTable.columns['principalId']).toBeDefined();
    expect(vfsSharePolicyPrincipalsTable.columns['accessLevel']).toBeDefined();
  });
});

describe('vfsAclEntryProvenanceTable', () => {
  it('tracks direct-vs-derived acl entry provenance', () => {
    expect(vfsAclEntryProvenanceTable.columns['aclEntryId']).toBeDefined();
    expect(vfsAclEntryProvenanceTable.columns['provenanceType']).toBeDefined();
    expect(vfsAclEntryProvenanceTable.columns['policyId']).toBeDefined();
    expect(vfsAclEntryProvenanceTable.columns['selectorId']).toBeDefined();
    expect(vfsAclEntryProvenanceTable.columns['compiledAt']).toBeDefined();
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

describe('vfsRegistryTable', () => {
  it('includes canonical folder metadata columns', () => {
    expect(vfsRegistryTable.columns['encryptedName']).toBeDefined();
    expect(vfsRegistryTable.columns['icon']).toBeDefined();
    expect(vfsRegistryTable.columns['viewMode']).toBeDefined();
    expect(vfsRegistryTable.columns['defaultSort']).toBeDefined();
    expect(vfsRegistryTable.columns['sortDirection']).toBeDefined();
  });
});

describe('allTables', () => {
  it('contains all canonical tables', () => {
    expect(allTables).toHaveLength(53);
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
    expect(allTables).toContain(vfsLinksTable);
    expect(allTables).toContain(playlistsTable);
    expect(allTables).toContain(albumsTable);
    expect(allTables).toContain(contactGroupsTable);
    expect(allTables).toContain(tagsTable);
    expect(allTables).toContain(emailsTable);
    expect(allTables).toContain(vfsAclEntriesTable);
    expect(allTables).toContain(vfsAclEntryProvenanceTable);
    expect(allTables).toContain(vfsSyncChangesTable);
    expect(allTables).toContain(vfsSyncClientStateTable);
    expect(allTables).toContain(vfsSharePoliciesTable);
    expect(allTables).toContain(vfsSharePolicySelectorsTable);
    expect(allTables).toContain(vfsSharePolicyPrincipalsTable);
    expect(allTables).not.toContain(vfsBlobObjectsTable);
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

describe('runtime table inventories', () => {
  it('keeps sqlite runtime tables aligned with canonical table inventory', () => {
    expect(sqliteRuntimeTables).toEqual(allTables);
  });

  it('keeps postgres runtime tables aligned with canonical table inventory', () => {
    expect(postgresRuntimeTables).toEqual(allTables);
  });

  it('keeps sqlite and postgres runtime inventories aligned', () => {
    expect(postgresRuntimeTables).toEqual(sqliteRuntimeTables);
  });
});
