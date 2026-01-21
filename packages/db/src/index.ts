// Schema types and definitions

// Generators
export {
  generatePostgresSchema,
  generateSqliteSchema
} from './generators/index.js';
export type {
  ColumnDefinition,
  ColumnReference,
  ColumnType,
  IndexDefinition,
  TableDefinition
} from './schema/index.js';
export {
  allTables,
  analyticsEventsTable,
  contactEmailsTable,
  contactPhonesTable,
  contactsTable,
  filesTable,
  isColumnReference,
  isColumnDefinition,
  isColumnType,
  isIndexDefinition,
  isTableDefinition,
  migrationsTable,
  secretsTable,
  syncMetadataTable,
  userSettingsTable
} from './schema/index.js';

// Type mappings
export type { PostgresTypeInfo, SqliteTypeInfo } from './utils/index.js';
export {
  formatDefaultValue,
  getPostgresTypeInfo,
  getSqliteTypeInfo,
  POSTGRES_TYPE_MAP,
  SQLITE_TYPE_MAP
} from './utils/index.js';
