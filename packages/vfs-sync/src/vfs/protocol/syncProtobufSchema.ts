import protobuf from 'protobufjs';

function createUint64MapField(id: number): protobuf.IField {
  const field: protobuf.IField = {
    rule: 'map',
    type: 'uint64',
    id
  };
  Object.defineProperty(field, 'keyType', {
    value: 'string',
    enumerable: true,
    writable: true,
    configurable: true
  });
  return field;
}

const MESSAGE_ROOT = protobuf.Root.fromJSON({
  nested: {
    tearleads: {
      nested: {
        vfs: {
          nested: {
            OpType: {
              values: {
                OP_TYPE_UNSPECIFIED: 0,
                ACL_ADD: 1,
                ACL_REMOVE: 2,
                LINK_ADD: 3,
                LINK_REMOVE: 4,
                ITEM_UPSERT: 5,
                ITEM_DELETE: 6
              }
            },
            PrincipalType: {
              values: {
                PRINCIPAL_TYPE_UNSPECIFIED: 0,
                USER: 1,
                GROUP: 2,
                ORGANIZATION: 3
              }
            },
            AccessLevel: {
              values: {
                ACCESS_LEVEL_UNSPECIFIED: 0,
                READ: 1,
                WRITE: 2,
                ADMIN: 3
              }
            },
            PushStatus: {
              values: {
                PUSH_STATUS_UNSPECIFIED: 0,
                APPLIED: 1,
                STALE_WRITE_ID: 2,
                OUTDATED_OP: 3,
                INVALID_OP: 4,
                ALREADY_APPLIED: 5,
                ENCRYPTED_ENVELOPE_UNSUPPORTED: 6
              }
            },
            CrdtOperation: {
              fields: {
                opId: { type: 'bytes', id: 1 },
                opType: { type: 'OpType', id: 2 },
                itemId: { type: 'bytes', id: 3 },
                replicaId: { type: 'bytes', id: 4 },
                writeId: { type: 'uint64', id: 5 },
                occurredAtMs: { type: 'uint64', id: 6 },
                principalId: { type: 'bytes', id: 7 },
                principalType: { type: 'PrincipalType', id: 8 },
                accessLevel: { type: 'AccessLevel', id: 9 },
                parentId: { type: 'bytes', id: 10 },
                childId: { type: 'bytes', id: 11 },
                actorId: { type: 'bytes', id: 12 },
                sourceTable: { type: 'string', id: 13 },
                sourceId: { type: 'bytes', id: 14 },
                keyEpoch: { type: 'uint32', id: 16 },
                encryptedPayloadBytes: { type: 'bytes', id: 20 },
                encryptionNonceBytes: { type: 'bytes', id: 21 },
                encryptionAadBytes: { type: 'bytes', id: 22 },
                encryptionSignatureBytes: { type: 'bytes', id: 23 }
              }
            },
            PushRequest: {
              fields: {
                clientId: { type: 'bytes', id: 1 },
                operations: { rule: 'repeated', type: 'CrdtOperation', id: 2 },
                version: { type: 'uint32', id: 3 }
              }
            },
            PushResult: {
              fields: {
                opId: { type: 'bytes', id: 1 },
                status: { type: 'PushStatus', id: 2 }
              }
            },
            PushResponse: {
              fields: {
                clientId: { type: 'bytes', id: 1 },
                results: { rule: 'repeated', type: 'PushResult', id: 2 }
              }
            },
            PullResponse: {
              fields: {
                items: { rule: 'repeated', type: 'CrdtOperation', id: 1 },
                hasMore: { type: 'bool', id: 2 },
                nextCursor: { type: 'bytes', id: 3 },
                lastReconciledWriteIds: createUint64MapField(4),
                version: { type: 'uint32', id: 5 }
              }
            },
            ReconcileRequest: {
              fields: {
                clientId: { type: 'bytes', id: 1 },
                cursor: { type: 'bytes', id: 2 },
                lastReconciledWriteIds: createUint64MapField(3),
                version: { type: 'uint32', id: 4 }
              }
            },
            ReconcileResponse: {
              fields: {
                clientId: { type: 'bytes', id: 1 },
                cursor: { type: 'bytes', id: 2 },
                lastReconciledWriteIds: createUint64MapField(3)
              }
            },
            SyncSessionRequest: {
              fields: {
                clientId: { type: 'bytes', id: 1 },
                cursor: { type: 'bytes', id: 2 },
                limit: { type: 'uint32', id: 3 },
                operations: { rule: 'repeated', type: 'CrdtOperation', id: 4 },
                lastReconciledWriteIds: createUint64MapField(5),
                rootId: { type: 'bytes', id: 6 },
                version: { type: 'uint32', id: 7 }
              }
            },
            SyncSessionResponse: {
              fields: {
                push: { type: 'PushResponse', id: 1 },
                pull: { type: 'PullResponse', id: 2 },
                reconcile: { type: 'ReconcileResponse', id: 3 }
              }
            }
          }
        }
      }
    }
  }
});

export const PUSH_REQUEST_TYPE = MESSAGE_ROOT.lookupType(
  'tearleads.vfs.PushRequest'
);
export const PUSH_RESPONSE_TYPE = MESSAGE_ROOT.lookupType(
  'tearleads.vfs.PushResponse'
);
export const PULL_RESPONSE_TYPE = MESSAGE_ROOT.lookupType(
  'tearleads.vfs.PullResponse'
);
export const RECONCILE_REQUEST_TYPE = MESSAGE_ROOT.lookupType(
  'tearleads.vfs.ReconcileRequest'
);
export const RECONCILE_RESPONSE_TYPE = MESSAGE_ROOT.lookupType(
  'tearleads.vfs.ReconcileResponse'
);
export const SYNC_SESSION_REQUEST_TYPE = MESSAGE_ROOT.lookupType(
  'tearleads.vfs.SyncSessionRequest'
);
export const SYNC_SESSION_RESPONSE_TYPE = MESSAGE_ROOT.lookupType(
  'tearleads.vfs.SyncSessionResponse'
);
