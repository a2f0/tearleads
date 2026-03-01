import protobuf from 'protobufjs';

const MESSAGE_ROOT = protobuf.Root.fromJSON({
  nested: {
    tearleads: {
      nested: {
        vfs: {
          nested: {
            CrdtOperation: {
              fields: {
                opId: { type: 'string', id: 1 },
                opType: { type: 'string', id: 2 },
                itemId: { type: 'string', id: 3 },
                replicaId: { type: 'string', id: 4 },
                writeId: { type: 'uint64', id: 5 },
                occurredAt: { type: 'string', id: 6 },
                principalId: { type: 'string', id: 7 },
                principalType: { type: 'string', id: 8 },
                accessLevel: { type: 'string', id: 9 },
                parentId: { type: 'string', id: 10 },
                childId: { type: 'string', id: 11 },
                actorId: { type: 'string', id: 12 },
                sourceTable: { type: 'string', id: 13 },
                sourceId: { type: 'string', id: 14 },
                encryptedPayload: { type: 'string', id: 15 },
                keyEpoch: { type: 'uint32', id: 16 },
                encryptionNonce: { type: 'string', id: 17 },
                encryptionAad: { type: 'string', id: 18 },
                encryptionSignature: { type: 'string', id: 19 }
              }
            },
            PushRequest: {
              fields: {
                clientId: { type: 'string', id: 1 },
                operations: { rule: 'repeated', type: 'CrdtOperation', id: 2 }
              }
            },
            PushResult: {
              fields: {
                opId: { type: 'string', id: 1 },
                status: { type: 'string', id: 2 }
              }
            },
            PushResponse: {
              fields: {
                clientId: { type: 'string', id: 1 },
                results: { rule: 'repeated', type: 'PushResult', id: 2 }
              }
            },
            PullResponse: {
              fields: {
                items: { rule: 'repeated', type: 'CrdtOperation', id: 1 },
                hasMore: { type: 'bool', id: 2 },
                nextCursor: { type: 'string', id: 3 },
                lastReconciledWriteIds: {
                  keyType: 'string',
                  type: 'uint64',
                  id: 4,
                  rule: 'map'
                }
              }
            },
            ReconcileRequest: {
              fields: {
                clientId: { type: 'string', id: 1 },
                cursor: { type: 'string', id: 2 },
                lastReconciledWriteIds: {
                  keyType: 'string',
                  type: 'uint64',
                  id: 3,
                  rule: 'map'
                }
              }
            },
            ReconcileResponse: {
              fields: {
                clientId: { type: 'string', id: 1 },
                cursor: { type: 'string', id: 2 },
                lastReconciledWriteIds: {
                  keyType: 'string',
                  type: 'uint64',
                  id: 3,
                  rule: 'map'
                }
              }
            },
            SyncSessionRequest: {
              fields: {
                clientId: { type: 'string', id: 1 },
                cursor: { type: 'string', id: 2 },
                limit: { type: 'uint32', id: 3 },
                operations: { rule: 'repeated', type: 'CrdtOperation', id: 4 },
                lastReconciledWriteIds: {
                  keyType: 'string',
                  type: 'uint64',
                  id: 5,
                  rule: 'map'
                },
                rootId: { type: 'string', id: 6 }
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
