import { randomUUID } from 'node:crypto';

type VfsPermissionLevel = 'view' | 'edit' | 'download';
type VfsShareType = 'user' | 'group' | 'organization';

interface VfsShare {
  id: string;
  itemId: string;
  shareType: VfsShareType;
  targetId: string;
  targetName: string;
  permissionLevel: VfsPermissionLevel;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  expiresAt: string | null;
}

interface VfsCrdtPushOperation {
  opId: string;
  opType: 'item_upsert' | 'link_add';
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  parentId?: string;
  childId?: string;
  encryptedPayload?: string;
  keyEpoch?: number;
  encryptionNonce?: string;
  encryptionAad?: string;
  encryptionSignature?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface JsonApiActor {
  fetchJson(path: string, init?: RequestInit): Promise<unknown>;
}

export interface SetupBobNotesShareForAliceInput {
  bob: JsonApiActor;
  aliceUserId: string;
  createLink: (input: { parentId: string; childId: string }) => Promise<void>;
  rootItemId?: string;
  folderId?: string;
  noteId?: string;
  folderName?: string;
  noteName?: string;
  folderSessionKey?: string;
  noteSessionKey?: string;
  notePlaintext?: string;
  permissionLevel?: VfsPermissionLevel;
  clientId?: string;
  idFactory?: () => string;
  now?: () => Date;
}

export interface SetupBobNotesShareForAliceResult {
  folderId: string;
  noteId: string;
  share: VfsShare;
  crdtResults: Array<{ opId: string; status: string }>;
}

const DEFAULT_ROOT_ITEM_ID = 'root';
const DEFAULT_FOLDER_SESSION_KEY = 'bob-folder-session-key';
const DEFAULT_NOTE_SESSION_KEY = 'bob-note-session-key';
const DEFAULT_FOLDER_NAME = 'Notes shared with Alice';
const DEFAULT_NOTE_NAME = 'Shared note for Alice';
const DEFAULT_NOTE_PLAINTEXT = "Note shared from Bob's VFS";
const DEFAULT_PERMISSION_LEVEL: VfsPermissionLevel = 'view';
const DEFAULT_CLIENT_ID = 'bob-scaffolding';

function isVfsShareType(value: unknown): value is VfsShare['shareType'] {
  return value === 'user' || value === 'group' || value === 'organization';
}

function isVfsPermissionLevel(
  value: unknown
): value is VfsShare['permissionLevel'] {
  return value === 'view' || value === 'edit' || value === 'download';
}

function buildOccurredAt(now: () => Date, stepMs: number): string {
  return new Date(now().getTime() + stepMs).toISOString();
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function parseCrdtResults(
  value: unknown
): Array<{ opId: string; status: string }> {
  if (!isRecord(value) || !Array.isArray(value['results'])) {
    throw new Error('Unexpected /vfs/crdt/push response');
  }

  const output: Array<{ opId: string; status: string }> = [];
  for (const result of value['results']) {
    if (!isRecord(result)) {
      throw new Error('Unexpected /vfs/crdt/push result payload');
    }
    const opId = result['opId'];
    const status = result['status'];
    if (typeof opId !== 'string' || typeof status !== 'string') {
      throw new Error('Unexpected /vfs/crdt/push result fields');
    }
    output.push({ opId, status });
  }
  return output;
}

function parseShare(value: unknown): VfsShare {
  if (!isRecord(value) || !isRecord(value['share'])) {
    throw new Error('Unexpected share creation response');
  }

  const share = value['share'];
  const shareType = share['shareType'];
  const permissionLevel = share['permissionLevel'];
  if (
    typeof share['id'] !== 'string' ||
    typeof share['itemId'] !== 'string' ||
    typeof shareType !== 'string' ||
    typeof share['targetId'] !== 'string' ||
    typeof share['targetName'] !== 'string' ||
    typeof permissionLevel !== 'string' ||
    typeof share['createdBy'] !== 'string' ||
    typeof share['createdByEmail'] !== 'string' ||
    typeof share['createdAt'] !== 'string' ||
    (share['expiresAt'] !== null && typeof share['expiresAt'] !== 'string') ||
    !isVfsShareType(shareType) ||
    !isVfsPermissionLevel(permissionLevel)
  ) {
    throw new Error('Unexpected share fields in response');
  }

  return {
    id: share['id'],
    itemId: share['itemId'],
    shareType,
    targetId: share['targetId'],
    targetName: share['targetName'],
    permissionLevel,
    createdBy: share['createdBy'],
    createdByEmail: share['createdByEmail'],
    createdAt: share['createdAt'],
    expiresAt: share['expiresAt']
  };
}

export async function setupBobNotesShareForAlice(
  input: SetupBobNotesShareForAliceInput
): Promise<SetupBobNotesShareForAliceResult> {
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const folderId = input.folderId ?? `folder-${idFactory()}`;
  const noteId = input.noteId ?? `note-${idFactory()}`;
  const rootItemId = input.rootItemId ?? DEFAULT_ROOT_ITEM_ID;
  const folderName = input.folderName ?? DEFAULT_FOLDER_NAME;
  const noteName = input.noteName ?? DEFAULT_NOTE_NAME;
  const folderSessionKey = input.folderSessionKey ?? DEFAULT_FOLDER_SESSION_KEY;
  const noteSessionKey = input.noteSessionKey ?? DEFAULT_NOTE_SESSION_KEY;
  const notePlaintext = input.notePlaintext ?? DEFAULT_NOTE_PLAINTEXT;
  const permissionLevel = input.permissionLevel ?? DEFAULT_PERMISSION_LEVEL;
  const clientId = input.clientId ?? DEFAULT_CLIENT_ID;

  await input.bob.fetchJson('/vfs/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: folderId,
      objectType: 'folder',
      encryptedSessionKey: folderSessionKey,
      encryptedName: folderName
    })
  });

  await input.bob.fetchJson('/vfs/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: noteId,
      objectType: 'note',
      encryptedSessionKey: noteSessionKey,
      encryptedName: noteName
    })
  });

  const operations: VfsCrdtPushOperation[] = [
    {
      opId: `op-${idFactory()}`,
      opType: 'item_upsert',
      itemId: noteId,
      replicaId: clientId,
      writeId: 1,
      occurredAt: buildOccurredAt(now, 0),
      encryptedPayload: toBase64(notePlaintext),
      keyEpoch: 1,
      encryptionNonce: toBase64(`nonce-${idFactory()}`),
      encryptionAad: toBase64(`aad-${idFactory()}`),
      encryptionSignature: toBase64(`sig-${idFactory()}`)
    }
  ];

  await input.createLink({
    parentId: rootItemId,
    childId: folderId
  });
  await input.createLink({
    parentId: folderId,
    childId: noteId
  });

  const pushResponse = await input.bob.fetchJson('/vfs/crdt/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId,
      operations
    })
  });

  const shareResponse = await input.bob.fetchJson(
    `/vfs/items/${encodeURIComponent(folderId)}/shares`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: folderId,
        shareType: 'user',
        targetId: input.aliceUserId,
        permissionLevel
      })
    }
  );

  return {
    folderId,
    noteId,
    share: parseShare(shareResponse),
    crdtResults: parseCrdtResults(pushResponse)
  };
}
