import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import type { VfsSyncCursor } from './sync-cursor.js';

export interface EffectiveVfsAclKeyViewEntry {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  updatedAt: string;
}

export interface VfsMemberPrincipalView {
  userId: string;
  groupIds: string[];
  organizationIds: string[];
}

export interface EffectiveVfsMemberItemAccessEntry {
  itemId: string;
  accessLevel: VfsAclAccessLevel;
  principalType: VfsAclPrincipalType;
  principalId: string;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  updatedAt: string;
}

export interface VfsAuthoritativeMembershipSnapshot {
  cursor: VfsSyncCursor;
  members: VfsMemberPrincipalView[];
}

export interface VfsAuthoritativePrincipalCatalogSnapshot {
  cursor: VfsSyncCursor;
  groupIds: string[];
  organizationIds: string[];
}
