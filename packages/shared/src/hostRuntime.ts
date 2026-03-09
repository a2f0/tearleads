/**
 * Shared host-runtime contracts consumed by feature packages and the client.
 */

/**
 * Database lifecycle state that feature runtime adapters must receive.
 */
export interface HostRuntimeDatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
}

/**
 * Base props contract that every feature runtime provider must extend.
 * Does not include `children` because `@tearleads/shared` has no React dependency;
 * each React provider already declares its own `children` prop.
 */
export interface HostRuntimeBaseProps {
  databaseState: HostRuntimeDatabaseState;
}

/**
 * Generic translation function shape for feature runtime adapters.
 */
export type HostRuntimeTranslation<TKey extends string = string> = (
  key: TKey
) => string;

/**
 * Shared navigation options shape for "navigate with origin" flows.
 */
export interface HostRuntimeNavigateOptions {
  fromLabel?: string;
  state?: Record<string, unknown>;
}
