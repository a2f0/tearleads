import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import {
  aiConversations,
  aiMessages,
  albums,
  composedEmails,
  contactGroups,
  emailAttachments,
  emails,
  playlists,
  tags,
  userKeys,
  vfsAclEntries,
  vfsItemState,
  vfsLinks,
  vfsRegistry,
  vfsSyncChanges,
  vfsSyncClientState,
  walletItemMedia,
  walletItems
} from './schema-content.js';
import {
  analyticsEvents,
  contactEmails,
  contactPhones,
  contacts,
  files,
  groups,
  healthBloodPressureReadings,
  healthExercises,
  healthWeightReadings,
  healthWorkoutEntries,
  migrations,
  notes,
  organizationBillingAccounts,
  organizations,
  revenuecatWebhookEvents,
  secrets,
  syncMetadata,
  userCredentials,
  userGroups,
  userOrganizations,
  userSettings,
  users,
  vehicles
} from './schema-foundation.js';
import {
  aiUsage,
  mlsGroupMembers,
  mlsGroupState,
  mlsGroups,
  mlsKeyPackages,
  mlsMessages,
  mlsWelcomeMessages,
  vfsCrdtOps
} from './schema-runtime.js';

export * from './schema-content.js';
export * from './schema-foundation.js';
export * from './schema-runtime.js';

/**
 * Schema object containing all table definitions.
 */
export const schema = {
  syncMetadata,
  userSettings,
  users,
  organizations,
  userOrganizations,
  organizationBillingAccounts,
  revenuecatWebhookEvents,
  userCredentials,
  migrations,
  secrets,
  files,
  contacts,
  contactPhones,
  contactEmails,
  analyticsEvents,
  notes,
  vehicles,
  healthExercises,
  healthWeightReadings,
  healthBloodPressureReadings,
  healthWorkoutEntries,
  groups,
  userGroups,
  userKeys,
  vfsRegistry,
  vfsLinks,
  vfsItemState,
  playlists,
  albums,
  contactGroups,
  aiConversations,
  aiMessages,
  tags,
  walletItems,
  walletItemMedia,
  emails,
  composedEmails,
  emailAttachments,
  vfsAclEntries,
  vfsSyncChanges,
  vfsSyncClientState,
  vfsCrdtOps,
  mlsKeyPackages,
  mlsGroups,
  mlsGroupMembers,
  mlsMessages,
  mlsWelcomeMessages,
  mlsGroupState,
  aiUsage
};

/**
 * Database type for SQLite with full schema.
 */
export type Database = SqliteRemoteDatabase<typeof schema>;
