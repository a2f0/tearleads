import {
  loadMlsWasmPrimitiveBindings,
  type MlsWasmPrimitiveBindings
} from './mlsWasmBackend.js';

interface RecordLike {
  [key: string]: unknown;
}

interface GroupMemberMetadata {
  userId: string;
  leafIndex: number;
}

interface GroupStateMetadata {
  groupId: string;
  epoch: number;
  selfUserId: string;
  members: GroupMemberMetadata[];
}

interface GeneratedCredential {
  credentialBundle: Uint8Array;
  privateKey: Uint8Array;
  createdAtMs: number;
}

interface GeneratedKeyPackage {
  keyPackage: Uint8Array;
  keyPackageRef: string;
  privateKey: Uint8Array;
  createdAtMs: number;
}

interface AddMemberResult {
  state: Uint8Array;
  commit: Uint8Array;
  welcome: Uint8Array;
  groupInfo: Uint8Array;
  newEpoch: number;
}

interface RemoveMemberResult {
  state: Uint8Array;
  commit: Uint8Array;
  newEpoch: number;
}

interface DecryptResult {
  senderId: string;
  plaintext: Uint8Array;
  authenticatedData: Uint8Array;
}

interface ImportStateResult {
  state: Uint8Array;
  epoch: number;
}

function isRecordLike(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null;
}

function readString(record: RecordLike, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`WASM response field '${field}' must be a string`);
  }
  return value;
}

function readNumber(record: RecordLike, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`WASM response field '${field}' must be a finite number`);
  }
  return value;
}

function readUint8Array(record: RecordLike, field: string): Uint8Array {
  const value = record[field];
  if (!(value instanceof Uint8Array)) {
    throw new Error(`WASM response field '${field}' must be Uint8Array`);
  }
  return value;
}

function readObjectArray(record: RecordLike, field: string): RecordLike[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error(`WASM response field '${field}' must be an array`);
  }

  const output: RecordLike[] = [];
  for (const item of value) {
    if (!isRecordLike(item)) {
      throw new Error(`WASM response field '${field}' entries must be objects`);
    }
    output.push(item);
  }
  return output;
}

function parseGeneratedCredential(value: unknown): GeneratedCredential {
  if (!isRecordLike(value)) {
    throw new Error('WASM credential response must be an object');
  }

  return {
    credentialBundle: readUint8Array(value, 'credential_bundle'),
    privateKey: readUint8Array(value, 'private_key'),
    createdAtMs: readNumber(value, 'created_at_ms')
  };
}

function parseGeneratedKeyPackage(value: unknown): GeneratedKeyPackage {
  if (!isRecordLike(value)) {
    throw new Error('WASM key package response must be an object');
  }

  return {
    keyPackage: readUint8Array(value, 'key_package'),
    keyPackageRef: readString(value, 'key_package_ref'),
    privateKey: readUint8Array(value, 'private_key'),
    createdAtMs: readNumber(value, 'created_at_ms')
  };
}

function parseGroupStateMetadata(value: unknown): GroupStateMetadata {
  if (!isRecordLike(value)) {
    throw new Error('WASM metadata response must be an object');
  }

  const memberRecords = readObjectArray(value, 'members');
  const members: GroupMemberMetadata[] = memberRecords.map((member) => ({
    userId: readString(member, 'user_id'),
    leafIndex: readNumber(member, 'leaf_index')
  }));

  return {
    groupId: readString(value, 'group_id'),
    epoch: readNumber(value, 'epoch'),
    selfUserId: readString(value, 'self_user_id'),
    members
  };
}

function parseAddMemberResult(value: unknown): AddMemberResult {
  if (!isRecordLike(value)) {
    throw new Error('WASM add-member response must be an object');
  }

  return {
    state: readUint8Array(value, 'state'),
    commit: readUint8Array(value, 'commit'),
    welcome: readUint8Array(value, 'welcome'),
    groupInfo: readUint8Array(value, 'group_info'),
    newEpoch: readNumber(value, 'new_epoch')
  };
}

function parseRemoveMemberResult(value: unknown): RemoveMemberResult {
  if (!isRecordLike(value)) {
    throw new Error('WASM remove-member response must be an object');
  }

  return {
    state: readUint8Array(value, 'state'),
    commit: readUint8Array(value, 'commit'),
    newEpoch: readNumber(value, 'new_epoch')
  };
}

function parseDecryptResult(value: unknown): DecryptResult {
  if (!isRecordLike(value)) {
    throw new Error('WASM decrypt response must be an object');
  }

  return {
    senderId: readString(value, 'sender_id'),
    plaintext: readUint8Array(value, 'plaintext'),
    authenticatedData: readUint8Array(value, 'authenticated_data')
  };
}

function parseImportStateResult(value: unknown): ImportStateResult {
  if (!isRecordLike(value)) {
    throw new Error('WASM import-state response must be an object');
  }

  return {
    state: readUint8Array(value, 'state'),
    epoch: readNumber(value, 'epoch')
  };
}

export async function wasmGenerateCredential(
  userId: string
): Promise<GeneratedCredential> {
  const bindings: MlsWasmPrimitiveBindings =
    await loadMlsWasmPrimitiveBindings();
  return parseGeneratedCredential(bindings.mls_generate_credential(userId));
}

export async function wasmGenerateKeyPackage(
  credentialBundle: Uint8Array,
  credentialPrivateKey: Uint8Array
): Promise<GeneratedKeyPackage> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return parseGeneratedKeyPackage(
    bindings.mls_generate_key_package(credentialBundle, credentialPrivateKey)
  );
}

export async function wasmCreateGroup(
  groupId: string,
  credentialBundle: Uint8Array,
  credentialPrivateKey: Uint8Array
): Promise<Uint8Array> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return bindings.mls_create_group(
    groupId,
    credentialBundle,
    credentialPrivateKey
  );
}

export async function wasmJoinGroup(
  groupId: string,
  welcomeBytes: Uint8Array,
  keyPackageRef: string,
  keyPackagePrivateKey: Uint8Array,
  credentialBundle: Uint8Array,
  credentialPrivateKey: Uint8Array
): Promise<Uint8Array> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return bindings.mls_join_group(
    groupId,
    welcomeBytes,
    keyPackageRef,
    keyPackagePrivateKey,
    credentialBundle,
    credentialPrivateKey
  );
}

export async function wasmGroupStateMetadata(
  stateBytes: Uint8Array
): Promise<GroupStateMetadata> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return parseGroupStateMetadata(bindings.mls_group_state_metadata(stateBytes));
}

export async function wasmAddMember(
  stateBytes: Uint8Array,
  memberKeyPackageBytes: Uint8Array
): Promise<AddMemberResult> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return parseAddMemberResult(
    bindings.mls_add_member(stateBytes, memberKeyPackageBytes)
  );
}

export async function wasmRemoveMember(
  stateBytes: Uint8Array,
  leafIndex: number
): Promise<RemoveMemberResult> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return parseRemoveMemberResult(
    bindings.mls_remove_member(stateBytes, leafIndex)
  );
}

export async function wasmProcessCommit(
  stateBytes: Uint8Array,
  commitBytes: Uint8Array
): Promise<Uint8Array> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return bindings.mls_process_commit(stateBytes, commitBytes);
}

export async function wasmEncryptMessage(
  stateBytes: Uint8Array,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return bindings.mls_encrypt_message(stateBytes, plaintext);
}

export async function wasmDecryptMessage(
  stateBytes: Uint8Array,
  ciphertext: Uint8Array
): Promise<DecryptResult> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return parseDecryptResult(
    bindings.mls_decrypt_message(stateBytes, ciphertext)
  );
}

export async function wasmExportGroupState(
  stateBytes: Uint8Array
): Promise<Uint8Array> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return bindings.mls_export_group_state(stateBytes);
}

export async function wasmImportGroupState(
  groupId: string,
  stateBytes: Uint8Array
): Promise<ImportStateResult> {
  const bindings = await loadMlsWasmPrimitiveBindings();
  return parseImportStateResult(
    bindings.mls_import_group_state(groupId, stateBytes)
  );
}

export function membersToLeafIndexMap(
  metadata: GroupStateMetadata
): Map<string, number> {
  const map = new Map<string, number>();
  for (const member of metadata.members) {
    map.set(member.userId, member.leafIndex);
  }
  return map;
}
