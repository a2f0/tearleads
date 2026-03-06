import type {
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@tearleads/shared';
import { isRecord, toNullableNumber, toSafeNumber } from './adminV2ValueUtils';

export function mapPostgresInfoResponse(
  responseBody: unknown
): PostgresAdminInfoResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const info = isRecord(response['info']) ? response['info'] : {};

  return {
    status: 'ok',
    info: {
      host: typeof info['host'] === 'string' ? info['host'] : null,
      port: toNullableNumber(info['port']),
      database: typeof info['database'] === 'string' ? info['database'] : null,
      user: typeof info['user'] === 'string' ? info['user'] : null
    },
    serverVersion:
      typeof response['serverVersion'] === 'string'
        ? response['serverVersion']
        : null
  };
}

export function mapPostgresTablesResponse(
  responseBody: unknown
): PostgresTablesResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const tableRows = Array.isArray(response['tables']) ? response['tables'] : [];

  return {
    tables: tableRows
      .filter((tableRow) => isRecord(tableRow))
      .map((tableRow) => ({
        schema:
          typeof tableRow['schema'] === 'string' ? tableRow['schema'] : '',
        name: typeof tableRow['name'] === 'string' ? tableRow['name'] : '',
        rowCount: toSafeNumber(tableRow['rowCount']),
        totalBytes: toSafeNumber(tableRow['totalBytes']),
        tableBytes: toSafeNumber(tableRow['tableBytes']),
        indexBytes: toSafeNumber(tableRow['indexBytes'])
      }))
  };
}

export function mapPostgresColumnsResponse(
  responseBody: unknown
): PostgresColumnsResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const columns = Array.isArray(response['columns']) ? response['columns'] : [];

  return {
    columns: columns
      .filter((column) => isRecord(column))
      .map((column) => ({
        name: typeof column['name'] === 'string' ? column['name'] : '',
        type: typeof column['type'] === 'string' ? column['type'] : '',
        nullable: Boolean(column['nullable']),
        defaultValue:
          typeof column['defaultValue'] === 'string'
            ? column['defaultValue']
            : null,
        ordinalPosition: toSafeNumber(column['ordinalPosition'])
      }))
  };
}

export function mapPostgresRowsResponse(
  responseBody: unknown
): PostgresRowsResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const rows = Array.isArray(response['rows']) ? response['rows'] : [];

  return {
    rows: rows.filter((row) => isRecord(row)),
    totalCount: toSafeNumber(response['totalCount']),
    limit: toSafeNumber(response['limit']),
    offset: toSafeNumber(response['offset'])
  };
}

export function mapRedisKeysResponse(responseBody: unknown): RedisKeysResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const keys = Array.isArray(response['keys']) ? response['keys'] : [];

  return {
    keys: keys
      .filter((entry) => isRecord(entry))
      .map((entry) => ({
        key: typeof entry['key'] === 'string' ? entry['key'] : '',
        type: typeof entry['type'] === 'string' ? entry['type'] : '',
        ttl: toSafeNumber(entry['ttl'])
      })),
    cursor: typeof response['cursor'] === 'string' ? response['cursor'] : '',
    hasMore: Boolean(response['hasMore'])
  };
}

export function mapRedisValueResponse(
  responseBody: unknown
): RedisKeyValueResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const valueField = isRecord(response['value']) ? response['value'] : {};

  let value: RedisKeyValueResponse['value'] = null;
  if (typeof valueField['stringValue'] === 'string') {
    value = valueField['stringValue'];
  } else if (
    isRecord(valueField['listValue']) &&
    Array.isArray(valueField['listValue']['values'])
  ) {
    value = valueField['listValue']['values'].filter(
      (entry): entry is string => typeof entry === 'string'
    );
  } else if (
    isRecord(valueField['mapValue']) &&
    isRecord(valueField['mapValue']['entries'])
  ) {
    const entries = valueField['mapValue']['entries'];
    const mappedEntries: Record<string, string> = {};
    for (const [key, entryValue] of Object.entries(entries)) {
      if (typeof entryValue === 'string') {
        mappedEntries[key] = entryValue;
      }
    }
    value = mappedEntries;
  }

  return {
    key: typeof response['key'] === 'string' ? response['key'] : '',
    type: typeof response['type'] === 'string' ? response['type'] : '',
    ttl: toSafeNumber(response['ttl']),
    value
  };
}

export function mapDeleteRedisKeyResponse(responseBody: unknown): {
  deleted: boolean;
} {
  const response = isRecord(responseBody) ? responseBody : {};
  if (typeof response['deleted'] === 'boolean') {
    return { deleted: response['deleted'] };
  }
  return { deleted: false };
}

export function mapDeleteGroupResponse(responseBody: unknown): {
  deleted: boolean;
} {
  const response = isRecord(responseBody) ? responseBody : {};
  if (typeof response['deleted'] === 'boolean') {
    return { deleted: response['deleted'] };
  }
  return { deleted: false };
}

export function mapAddGroupMemberResponse(responseBody: unknown): {
  added: boolean;
} {
  const response = isRecord(responseBody) ? responseBody : {};
  if (typeof response['added'] === 'boolean') {
    return { added: response['added'] };
  }
  return { added: false };
}

export function mapRemoveGroupMemberResponse(responseBody: unknown): {
  removed: boolean;
} {
  const response = isRecord(responseBody) ? responseBody : {};
  if (typeof response['removed'] === 'boolean') {
    return { removed: response['removed'] };
  }
  return { removed: false };
}

export function mapDeleteOrganizationResponse(responseBody: unknown): {
  deleted: boolean;
} {
  const response = isRecord(responseBody) ? responseBody : {};
  if (typeof response['deleted'] === 'boolean') {
    return { deleted: response['deleted'] };
  }
  return { deleted: false };
}

export function mapRedisDbSizeResponse(responseBody: unknown): {
  count: number;
} {
  const response = isRecord(responseBody) ? responseBody : {};
  if (
    typeof response['count'] === 'number' ||
    typeof response['count'] === 'string'
  ) {
    return { count: toSafeNumber(response['count']) };
  }
  return { count: 0 };
}
