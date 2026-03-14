import { Code, ConnectError } from '@connectrpc/connect';
import type { VfsShareType } from '@tearleads/shared';

export type ShareClaims = { sub: string };

export type SearchShareTargetsRequest = {
  q: string;
  type?: string;
  limit?: number;
};

export type SharePolicyPreviewRequest = {
  rootItemId: string;
  principalType: string;
  principalId: string;
  limit: number;
  cursor?: string | null;
  maxDepth?: number | null;
  q?: string | null;
  objectType?: string[] | null;
};

export interface OrganizationMembershipRow {
  organization_id: string | null;
}

export interface UserSearchRow {
  id: string;
  email: string;
}

export interface GroupSearchRow {
  id: string;
  name: string;
  org_name: string | null;
}

export interface OrganizationSearchRow {
  id: string;
  name: string;
  description: string | null;
}

export interface PreviewRootRow {
  owner_id: string | null;
  object_type: string;
}

export function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidShareType(value: unknown): value is VfsShareType {
  return value === 'user' || value === 'group' || value === 'organization';
}

export function normalizeSearchType(value: unknown): VfsShareType | null {
  return isValidShareType(value) ? value : null;
}

export function normalizeSearchLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 10;
  }

  return Math.min(Math.max(Math.floor(value), 1), 50);
}

function normalizePreviewLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return 100;
  }

  return Math.min(Math.floor(value), 500);
}

function normalizePreviewMaxDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return 50;
  }

  return Math.min(Math.floor(value), 50);
}

function normalizeObjectTypes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const objectTypes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new ConnectError(
        'objectType must contain only strings',
        Code.InvalidArgument
      );
    }

    const parts = entry.split(',');
    for (const part of parts) {
      const normalized = part.trim();
      if (normalized.length === 0) {
        continue;
      }
      if (normalized.length > 64) {
        throw new ConnectError(
          'objectType entries must be 64 characters or fewer',
          Code.InvalidArgument
        );
      }
      if (!objectTypes.includes(normalized)) {
        objectTypes.push(normalized);
      }
      if (objectTypes.length > 25) {
        throw new ConnectError(
          'objectType may include at most 25 entries',
          Code.InvalidArgument
        );
      }
    }
  }

  return objectTypes.length > 0 ? objectTypes : null;
}

export function normalizePreviewRequest(request: SharePolicyPreviewRequest): {
  rootItemId: string;
  principalType: VfsShareType;
  principalId: string;
  limit: number;
  cursor: string | null;
  maxDepth: number;
  search: string | null;
  objectTypes: string[] | null;
} {
  const rootItemId = normalizeRequiredString(request.rootItemId);
  const principalType = normalizeSearchType(request.principalType);
  const principalId = normalizeRequiredString(request.principalId);

  if (!rootItemId || !principalType || !principalId) {
    throw new ConnectError('Invalid preview request', Code.InvalidArgument);
  }

  return {
    rootItemId,
    principalType,
    principalId,
    limit: normalizePreviewLimit(request.limit),
    cursor: normalizeRequiredString(request.cursor),
    maxDepth: normalizePreviewMaxDepth(request.maxDepth),
    search: normalizeRequiredString(request.q),
    objectTypes: normalizeObjectTypes(request.objectType)
  };
}
