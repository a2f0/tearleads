import {
  type QueueVfsCrdtLocalOperationInput,
  VfsBackgroundSyncClient,
  type VfsBackgroundSyncClientFlushResult,
  type VfsBackgroundSyncClientOptions,
  type VfsBackgroundSyncClientPersistedState,
  type VfsBackgroundSyncClientSnapshot,
  type VfsBackgroundSyncClientSyncResult,
  type VfsCrdtOperation,
  type VfsCrdtSyncTransport,
  VfsHttpCrdtSyncTransport,
  type VfsHttpCrdtSyncTransportOptions,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import { fetchWithAuthRefresh } from './vfsAuthFetch';

export interface VfsApiCrdtTransportOptions
  extends Omit<VfsHttpCrdtSyncTransportOptions, 'fetchImpl' | 'getAuthToken'> {}

const DEFAULT_API_PREFIX = '/v1';

interface VfsRematerializedState {
  replaySnapshot: {
    acl: Array<{
      itemId: string;
      principalType: VfsAclPrincipalType;
      principalId: string;
      accessLevel: VfsAclAccessLevel;
    }>;
    links: Array<{
      parentId: string;
      childId: string;
    }>;
    cursor: VfsSyncCursor | null;
  };
  reconcileState: {
    cursor: VfsSyncCursor;
    lastReconciledWriteIds: Record<string, number>;
  } | null;
  containerClocks: Array<{
    containerId: string;
    changedAt: string;
    changeId: string;
  }>;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl) {
    return '';
  }
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeApiPrefix(apiPrefix: string | undefined): string {
  const raw = apiPrefix ?? DEFAULT_API_PREFIX;
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTimestamp(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }
  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }
  return new Date(parsedMs).toISOString();
}

function isPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return value === 'user' || value === 'group' || value === 'organization';
}

function isAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return value === 'read' || value === 'write' || value === 'admin';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseWriteId(value: unknown): number | null {
  if (typeof value !== 'number') {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function parseCursor(value: unknown): VfsSyncCursor | null {
  if (!isRecord(value)) {
    return null;
  }
  const changedAt = normalizeTimestamp(value['changedAt']);
  const changeId = normalizeRequiredString(value['changeId']);
  if (!changedAt || !changeId) {
    return null;
  }
  return { changedAt, changeId };
}

function parseLastReconciledWriteIds(
  value: unknown
): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }

  const entries: Array<[string, number]> = [];
  for (const [replicaIdRaw, writeIdRaw] of Object.entries(value)) {
    const replicaId = normalizeRequiredString(replicaIdRaw);
    const writeId = parseWriteId(writeIdRaw);
    if (!replicaId || writeId === null) {
      continue;
    }
    entries.push([replicaId, writeId]);
  }

  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

function parseServerRematerializedState(value: unknown): VfsRematerializedState | null {
  if (!isRecord(value)) {
    return null;
  }

  const replaySnapshotValue = value['replaySnapshot'];
  const reconcileStateValue = value['reconcileState'];
  const containerClocksValue = value['containerClocks'];
  if (!isRecord(replaySnapshotValue) || !Array.isArray(containerClocksValue)) {
    return null;
  }

  const replayAclValue = replaySnapshotValue['acl'];
  const replayLinksValue = replaySnapshotValue['links'];
  const replayCursorValue = replaySnapshotValue['cursor'];
  if (!Array.isArray(replayAclValue) || !Array.isArray(replayLinksValue)) {
    return null;
  }

  const replayAcl: VfsRematerializedState['replaySnapshot']['acl'] = [];
  for (const entry of replayAclValue) {
    if (!isRecord(entry)) {
      continue;
    }
    const itemId = normalizeRequiredString(entry['itemId']);
    const principalType = isPrincipalType(entry['principalType'])
      ? entry['principalType']
      : null;
    const principalId = normalizeRequiredString(entry['principalId']);
    const accessLevel = isAccessLevel(entry['accessLevel'])
      ? entry['accessLevel']
      : null;
    if (!itemId || !principalType || !principalId || !accessLevel) {
      continue;
    }
    replayAcl.push({
      itemId,
      principalType,
      principalId,
      accessLevel
    });
  }

  const replayLinks: VfsRematerializedState['replaySnapshot']['links'] = [];
  for (const entry of replayLinksValue) {
    if (!isRecord(entry)) {
      continue;
    }
    const parentId = normalizeRequiredString(entry['parentId']);
    const childId = normalizeRequiredString(entry['childId']);
    if (!parentId || !childId) {
      continue;
    }
    replayLinks.push({
      parentId,
      childId
    });
  }

  const containerClocks: VfsRematerializedState['containerClocks'] = [];
  for (const entry of containerClocksValue) {
    if (!isRecord(entry)) {
      continue;
    }
    const containerId = normalizeRequiredString(entry['containerId']);
    const changedAt = normalizeTimestamp(entry['changedAt']);
    const changeId = normalizeRequiredString(entry['changeId']);
    if (!containerId || !changedAt || !changeId) {
      continue;
    }
    containerClocks.push({
      containerId,
      changedAt,
      changeId
    });
  }

  let reconcileState: VfsRematerializedState['reconcileState'] = null;
  if (reconcileStateValue !== null && reconcileStateValue !== undefined) {
    if (!isRecord(reconcileStateValue)) {
      return null;
    }
    const cursor = parseCursor(reconcileStateValue['cursor']);
    const lastReconciledWriteIds = parseLastReconciledWriteIds(
      reconcileStateValue['lastReconciledWriteIds']
    );
    if (!cursor || !lastReconciledWriteIds) {
      return null;
    }
    reconcileState = {
      cursor,
      lastReconciledWriteIds
    };
  }

  const replayCursor =
    replayCursorValue === null ? null : parseCursor(replayCursorValue);
  if (replayCursorValue !== null && !replayCursor) {
    return null;
  }

  return {
    replaySnapshot: {
      acl: replayAcl,
      links: replayLinks,
      cursor: replayCursor
    },
    reconcileState,
    containerClocks
  };
}

async function fetchServerRematerializedState(input: {
  baseUrl: string | undefined;
  apiPrefix: string | undefined;
  clientId: string;
}): Promise<VfsRematerializedState | null> {
  const params = new URLSearchParams();
  params.set('clientId', input.clientId);

  const requestUrl = `${normalizeBaseUrl(input.baseUrl)}${normalizeApiPrefix(input.apiPrefix)}/vfs/crdt/snapshot?${params.toString()}`;
  const response = await fetchWithAuthRefresh(fetch, requestUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch CRDT rematerialization snapshot (${response.status})`
    );
  }

  const responseBody: unknown = await response.json();
  const parsedState = parseServerRematerializedState(responseBody);
  if (!parsedState) {
    throw new Error('Server returned invalid CRDT rematerialization snapshot');
  }

  return parsedState;
}

function buildRematerializationHandler(input: {
  baseUrl: string | undefined;
  apiPrefix: string | undefined;
  enableServerSnapshotFallback: boolean;
  userHandler: VfsBackgroundSyncClientOptions['onRematerializationRequired'];
}): VfsBackgroundSyncClientOptions['onRematerializationRequired'] | undefined {
  if (!input.userHandler && !input.enableServerSnapshotFallback) {
    return undefined;
  }

  return async (event) => {
    const userResult = input.userHandler
      ? ((await input.userHandler(event)) ?? null)
      : null;
    if (userResult) {
      return userResult;
    }

    if (!input.enableServerSnapshotFallback) {
      return userResult;
    }

    return fetchServerRematerializedState({
      baseUrl: input.baseUrl,
      apiPrefix: input.apiPrefix,
      clientId: event.clientId
    });
  };
}

export function createVfsApiCrdtTransport(
  options: VfsApiCrdtTransportOptions = {}
): VfsCrdtSyncTransport {
  return new VfsHttpCrdtSyncTransport({
    ...options,
    fetchImpl: (input, init) => fetchWithAuthRefresh(fetch, input, init)
  });
}

type PersistStateCallback = (
  state: VfsBackgroundSyncClientPersistedState
) => Promise<void> | void;

type LoadStateCallback = () =>
  | Promise<VfsBackgroundSyncClientPersistedState | null>
  | VfsBackgroundSyncClientPersistedState
  | null;

export interface VfsApiNetworkFlusherOptions
  extends VfsBackgroundSyncClientOptions {
  transport?: VfsCrdtSyncTransport;
  transportOptions?: VfsApiCrdtTransportOptions;
  saveState?: PersistStateCallback;
  loadState?: LoadStateCallback;
}

export class VfsApiNetworkFlusher {
  private readonly client: VfsBackgroundSyncClient;
  private readonly saveState: PersistStateCallback | null;
  private readonly loadState: LoadStateCallback | null;

  constructor(
    userId: string,
    clientId: string,
    options: VfsApiNetworkFlusherOptions = {}
  ) {
    const transportOptions = options.transportOptions ?? {};
    const transport =
      options.transport ?? createVfsApiCrdtTransport(transportOptions);
    const onRematerializationRequired = buildRematerializationHandler({
      baseUrl: transportOptions.baseUrl,
      apiPrefix: transportOptions.apiPrefix,
      enableServerSnapshotFallback: options.transport === undefined,
      userHandler: options.onRematerializationRequired
    });

    this.client = new VfsBackgroundSyncClient(
      userId,
      clientId,
      transport,
      {
        ...(options.pullLimit !== undefined && {
          pullLimit: options.pullLimit
        }),
        ...(options.now !== undefined && { now: options.now }),
        ...(options.maxRematerializationAttempts !== undefined && {
          maxRematerializationAttempts: options.maxRematerializationAttempts
        }),
        ...(onRematerializationRequired !== undefined && {
          onRematerializationRequired
        }),
        ...(options.onBackgroundError !== undefined && {
          onBackgroundError: options.onBackgroundError
        }),
        ...(options.onGuardrailViolation !== undefined && {
          onGuardrailViolation: options.onGuardrailViolation
        })
      }
    );
    this.saveState = options.saveState ?? null;
    this.loadState = options.loadState ?? null;
  }

  async hydrateFromPersistence(): Promise<boolean> {
    if (!this.loadState) {
      return false;
    }

    const state = await this.loadState();
    if (state === null) {
      return false;
    }

    this.client.hydrateState(state);
    return true;
  }

  async persistState(): Promise<void> {
    if (!this.saveState) {
      return;
    }

    await this.saveState(this.client.exportState());
  }

  queueLocalOperation(
    input: QueueVfsCrdtLocalOperationInput
  ): VfsCrdtOperation {
    return this.client.queueLocalOperation(input);
  }

  async queueLocalOperationAndPersist(
    input: QueueVfsCrdtLocalOperationInput
  ): Promise<VfsCrdtOperation> {
    const operation = this.client.queueLocalOperation(input);
    await this.persistState();
    return operation;
  }

  queuedOperations(): VfsCrdtOperation[] {
    return this.client.queuedOperations();
  }

  snapshot(): VfsBackgroundSyncClientSnapshot {
    return this.client.snapshot();
  }

  exportState(): VfsBackgroundSyncClientPersistedState {
    return this.client.exportState();
  }

  hydrateState(state: VfsBackgroundSyncClientPersistedState): void {
    this.client.hydrateState(state);
  }

  listChangedContainers(
    cursor: VfsSyncCursor | null,
    limit?: number
  ): ReturnType<VfsBackgroundSyncClient['listChangedContainers']> {
    return this.client.listChangedContainers(cursor, limit);
  }

  async flush(): Promise<VfsBackgroundSyncClientFlushResult> {
    const result = await this.client.flush();
    await this.persistState();
    return result;
  }

  async sync(): Promise<VfsBackgroundSyncClientSyncResult> {
    const result = await this.client.sync();
    await this.persistState();
    return result;
  }

  startBackgroundFlush(intervalMs: number): void {
    this.client.startBackgroundFlush(intervalMs);
  }

  async stopBackgroundFlush(waitForInFlightFlush = true): Promise<void> {
    await this.client.stopBackgroundFlush(waitForInFlightFlush);
    await this.persistState();
  }
}
