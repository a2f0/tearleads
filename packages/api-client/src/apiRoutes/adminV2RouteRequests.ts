export interface AdminGetColumnsRequest {
  schema: string;
  table: string;
}

export interface AdminGetRowsOptions {
  limit?: number;
  offset?: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface AdminGetRowsRequest {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sortColumn?: string;
  sortDirection?: string;
}

export interface AdminGetRedisKeysRequest {
  cursor: string;
  limit: number;
}

export interface AdminGetRedisValueRequest {
  key: string;
}

export function createAdminGetPostgresInfoRequest(): Record<string, never> {
  return {};
}

export function createAdminGetTablesRequest(): Record<string, never> {
  return {};
}

export function createAdminGetColumnsRequest(schema: string, table: string) {
  return { schema, table };
}

export function createAdminGetRowsRequest(
  schema: string,
  table: string,
  options?: AdminGetRowsOptions
): AdminGetRowsRequest {
  return {
    schema,
    table,
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
    ...(options?.sortColumn ? { sortColumn: options.sortColumn } : {}),
    ...(options?.sortDirection ? { sortDirection: options.sortDirection } : {})
  };
}

export function createAdminGetRedisKeysRequest(
  cursor?: string,
  limit?: number
): AdminGetRedisKeysRequest {
  return {
    cursor: cursor ?? '',
    limit: limit ?? 0
  };
}

export function createAdminGetRedisValueRequest(
  key: string
): AdminGetRedisValueRequest {
  return { key };
}

export function createAdminGetRedisDbSizeRequest(): Record<string, never> {
  return {};
}
