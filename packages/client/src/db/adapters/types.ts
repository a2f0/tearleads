/**
 * Re-export adapter types and utilities from @tearleads/db/adapter.
 * Platform-specific adapter implementations in this directory import from here.
 */
export type {
  DatabaseAdapter,
  DatabaseConfig,
  DrizzleConnection,
  PlatformInfo,
  QueryResult
} from '@tearleads/db/adapter';

export { getPlatformInfo } from '@tearleads/db/adapter';
