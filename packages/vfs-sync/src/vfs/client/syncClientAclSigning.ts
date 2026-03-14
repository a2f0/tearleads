import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import type {
  VfsAclOperationSigner,
  VfsAclOperationSigningInput
} from './sync-client-utils.js';
import { normalizeRequiredString } from './sync-client-utils.js';

function toAclOperationSigningInput(
  operation: Readonly<VfsCrdtOperation>
): VfsAclOperationSigningInput | null {
  if (operation.opType !== 'acl_add' && operation.opType !== 'acl_remove') {
    return null;
  }

  const principalType = operation.principalType;
  const principalId = normalizeRequiredString(operation.principalId);
  if (!principalType || !principalId) {
    throw new Error(
      `ACL operation ${operation.opId} is missing signing fields`
    );
  }
  const accessLevel =
    operation.opType === 'acl_add'
      ? normalizeRequiredString(operation.accessLevel)
      : '';
  if (!accessLevel && operation.opType === 'acl_add') {
    throw new Error(
      `ACL operation ${operation.opId} is missing signing fields`
    );
  }

  return {
    opId: operation.opId,
    opType: operation.opType,
    itemId: operation.itemId,
    replicaId: operation.replicaId,
    writeId: operation.writeId,
    occurredAt: operation.occurredAt,
    principalType,
    principalId,
    accessLevel: accessLevel ?? ''
  };
}

export async function signPushOperations(input: {
  operations: VfsCrdtOperation[];
  signAclOperation: VfsAclOperationSigner | null;
}): Promise<VfsCrdtOperation[]> {
  if (!input.signAclOperation) {
    return input.operations;
  }

  const signedOperations: VfsCrdtOperation[] = [];
  for (const operation of input.operations) {
    const signingInput = toAclOperationSigningInput(operation);
    if (!signingInput) {
      signedOperations.push(operation);
      continue;
    }

    const signature = normalizeRequiredString(
      await input.signAclOperation(signingInput)
    );
    if (!signature) {
      throw new Error(
        `signAclOperation must return a signature for ACL operation ${operation.opId}`
      );
    }
    signedOperations.push({
      ...operation,
      operationSignature: signature
    });
  }

  return signedOperations;
}
