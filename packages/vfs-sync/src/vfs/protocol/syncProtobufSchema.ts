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
                ITEM_DELETE: 6,
                LINK_REASSIGN: 7
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
                ENCRYPTED_ENVELOPE_UNSUPPORTED: 6,
                ACL_DENIED: 7
              }
            },
            SyncBloomFilter: {
              fields: {
                data: { type: 'bytes', id: 1 },
                capacity: { type: 'uint32', id: 2 },
                errorRate: { type: 'float', id: 3 }
              }
            },
            CrdtOperation: {
              fields: {
                opId: { type: 'bytes', id: 17 },
                opType: { type: 'OpType', id: 18 },
                itemId: { type: 'bytes', id: 19 },
                replicaId: { type: 'bytes', id: 20 },
                writeId: { type: 'uint64', id: 21 },
                occurredAtMs: { type: 'uint64', id: 22 },
                principalType: { type: 'PrincipalType', id: 23 },
                principalId: { type: 'bytes', id: 24 },
                accessLevel: { type: 'AccessLevel', id: 25 },
                parentId: { type: 'bytes', id: 26 },
                childId: { type: 'bytes', id: 27 },
                encryptedPayload: { type: 'string', id: 12 },
                keyEpoch: { type: 'uint32', id: 13 },
                encryptionNonce: { type: 'string', id: 14 },
                encryptionAad: { type: 'string', id: 15 },
                encryptionSignature: { type: 'string', id: 16 },
                operationSignature: { type: 'bytes', id: 29 },
                sourceTable: { type: 'string', id: 10 },
                sourceId: { type: 'bytes', id: 30 }
              }
            },
            PushRequest: {
              fields: {
                organizationId: { type: 'bytes', id: 4 },
                clientId: { type: 'bytes', id: 5 },
                operations: { rule: 'repeated', type: 'CrdtOperation', id: 3 }
              }
            },
            PushResult: {
              fields: {
                opId: { type: 'bytes', id: 3 },
                status: { type: 'PushStatus', id: 4 }
              }
            },
            PushResponse: {
              fields: {
                clientId: { type: 'bytes', id: 3 },
                results: { rule: 'repeated', type: 'PushResult', id: 2 }
              }
            },
            PullResponse: {
              fields: {
                items: { rule: 'repeated', type: 'CrdtOperation', id: 1 },
                hasMore: { type: 'bool', id: 2 },
                nextCursor: { type: 'string', id: 3 },
                lastReconciledWriteIds: createUint64MapField(4),
                bloomFilter: { type: 'SyncBloomFilter', id: 5 }
              }
            },
            ReconcileRequest: {
              fields: {
                organizationId: { type: 'bytes', id: 5 },
                clientId: { type: 'bytes', id: 6 },
                cursor: { type: 'string', id: 3 },
                lastReconciledWriteIds: createUint64MapField(4)
              }
            },
            ReconcileResponse: {
              fields: {
                clientId: { type: 'bytes', id: 4 },
                cursor: { type: 'string', id: 2 },
                lastReconciledWriteIds: createUint64MapField(3)
              }
            },
            SyncSessionRequest: {
              fields: {
                organizationId: { type: 'bytes', id: 9 },
                clientId: { type: 'bytes', id: 10 },
                cursor: { type: 'string', id: 3 },
                limit: { type: 'uint32', id: 4 },
                operations: { rule: 'repeated', type: 'CrdtOperation', id: 5 },
                lastReconciledWriteIds: createUint64MapField(6),
                rootId: { type: 'bytes', id: 11 },
                bloomFilter: { type: 'SyncBloomFilter', id: 8 }
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
