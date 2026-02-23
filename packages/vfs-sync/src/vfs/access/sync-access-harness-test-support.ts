import type { VfsCrdtSyncItem } from '../protocol/sync-crdt-feed.js';

export function crdtAclAdd(params: {
  opId: string;
  occurredAt: string;
  itemId: string;
  principalType: 'user' | 'group' | 'organization';
  principalId: string;
  accessLevel: 'read' | 'write' | 'admin';
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.itemId,
    opType: 'acl_add',
    principalType: params.principalType,
    principalId: params.principalId,
    accessLevel: params.accessLevel,
    parentId: null,
    childId: null,
    actorId: 'user-1',
    sourceTable: 'vfs_crdt_client_push',
    sourceId: params.opId,
    occurredAt: params.occurredAt
  };
}

export function crdtLinkAdd(params: {
  opId: string;
  occurredAt: string;
  itemId: string;
  parentId: string;
  childId: string;
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.itemId,
    opType: 'link_add',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: params.parentId,
    childId: params.childId,
    actorId: 'user-1',
    sourceTable: 'vfs_links',
    sourceId: params.opId,
    occurredAt: params.occurredAt
  };
}
