/**
 * Web adapter for SQLite using official SQLite WASM with encryption in a Web Worker.
 * Uses SQLite3MultipleCiphers for at-rest encryption.
 * Database is persisted to OPFS as an encrypted blob.
 */

import { isRecord } from '@rapid/shared';

import type {
  WorkerRequest,
  WorkerResponse
} from '@/workers/sqlite.worker.interface';
import { generateRequestId } from '@/workers/sqlite.worker.interface';

import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';
import { convertRowsToArrays } from './utils';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT = 30000; // 30 seconds

/**
 * Type guard to check if a value is a QueryResult.
 */
function isQueryResult(value: unknown): value is QueryResult {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value['rows']);
}

/**
 * Assert that a value is a QueryResult, throwing if not.
 */
function assertQueryResult(value: unknown): QueryResult {
  if (!isQueryResult(value)) {
    throw new Error(`Expected QueryResult but got: ${typeof value}`);
  }
  return value;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

export class WebAdapter implements DatabaseAdapter {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;

  async initialize(config: DatabaseConfig): Promise<void> {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../../workers/sqlite.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = this.handleError.bind(this);

      // Wait for worker to be ready
      await this.waitForReady();
    }

    // Initialize/reopen the database
    // If the file exists in WASM VFS from a previous session, it will be reopened
    const id = generateRequestId();
    await this.sendRequest({
      type: 'INIT',
      id,
      config: {
        name: config.name,
        encryptionKey: Array.from(config.encryptionKey)
      }
    });
  }

  private waitForReady(): Promise<void> {
    if (this.isReady) return Promise.resolve();

    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;

        this.readyTimeout = setTimeout(() => {
          this.readyReject = null;
          this.readyResolve = null;
          this.readyTimeout = null;
          reject(new Error('Worker initialization timeout'));
        }, REQUEST_TIMEOUT);
      });
    }

    return this.readyPromise;
  }

  private handleMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;

    if (response.type === 'READY') {
      if (!this.isReady) {
        this.isReady = true;
        if (this.readyTimeout) {
          clearTimeout(this.readyTimeout);
          this.readyTimeout = null;
        }
        const resolve = this.readyResolve;
        this.readyResolve = null;
        this.readyReject = null;
        resolve?.();
      }
      return;
    }

    const id = 'id' in response ? response.id : null;
    if (!id) return;

    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(id);

    // Resolve or reject based on response type
    if (response.type === 'ERROR') {
      pending.reject(new Error(response.error));
    } else if (response.type === 'RESULT') {
      pending.resolve(response.data);
    } else if (response.type === 'EXPORT_RESULT') {
      pending.resolve({ data: response.data });
    } else {
      pending.resolve(undefined);
    }
  }

  private handleError(error: ErrorEvent): void {
    console.error('Worker error:', error);

    // Reject the ready promise if we're still waiting for initialization
    if (this.readyReject) {
      this.readyReject(
        new Error(`Worker initialization error: ${error.message}`)
      );
      this.readyReject = null;
      this.readyResolve = null;
      if (this.readyTimeout) {
        clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
      }
    }

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Worker error: ${error.message}`));
      this.pending.delete(id);
    }
  }

  private sendRequest(request: WorkerRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = 'id' in request ? request.id : generateRequestId();

      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${request.type}`));
      }, REQUEST_TIMEOUT);

      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage(request);
    });
  }

  async close(): Promise<void> {
    if (this.worker) {
      const id = generateRequestId();
      await this.sendRequest({ type: 'CLOSE', id });
      // Don't terminate worker - keep WASM VFS alive so file persists
      // The database is closed but the encrypted file stays in WASM memory
    }
  }

  /**
   * Terminate the worker completely.
   * Called during reset to destroy WASM memory.
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
  }

  isOpen(): boolean {
    return this.worker !== null && this.isReady;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    const id = generateRequestId();
    const result = await this.sendRequest({
      type: 'EXECUTE',
      id,
      query: { sql, params: params ?? [], method: 'all' }
    });

    const queryResult = assertQueryResult(result);

    // Return raw column names - callers that need camelCase should use SQL aliases
    return queryResult;
  }

  async executeMany(statements: string[]): Promise<void> {
    const id = generateRequestId();
    await this.sendRequest({
      type: 'EXECUTE_MANY',
      id,
      statements
    });
  }

  async beginTransaction(): Promise<void> {
    const id = generateRequestId();
    await this.sendRequest({ type: 'BEGIN_TRANSACTION', id });
  }

  async commitTransaction(): Promise<void> {
    const id = generateRequestId();
    await this.sendRequest({ type: 'COMMIT', id });
  }

  async rollbackTransaction(): Promise<void> {
    const id = generateRequestId();
    await this.sendRequest({ type: 'ROLLBACK', id });
  }

  async rekeyDatabase(newKey: Uint8Array, _oldKey?: Uint8Array): Promise<void> {
    const id = generateRequestId();
    await this.sendRequest({
      type: 'REKEY',
      id,
      newKey: Array.from(newKey)
    });
  }

  getConnection(): unknown {
    // For Drizzle sqlite-proxy, return a function that always returns { rows: any[] }
    // IMPORTANT: Drizzle sqlite-proxy expects rows as ARRAYS of values, not objects.
    // The values must be in the same order as columns in the SELECT clause.
    // We convert from the worker's object format to array format here.
    return async (
      sql: string,
      params: unknown[],
      method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const id = generateRequestId();
      const result = assertQueryResult(
        await this.sendRequest({
          type: 'EXECUTE',
          id,
          query: { sql, params, method: method === 'values' ? 'all' : method }
        })
      );

      // Drizzle sqlite-proxy expects { rows: any[] } for ALL methods
      // The rows must be ARRAYS of values in SELECT column order, not objects.
      // convertRowsToArrays handles both explicit SELECT and SELECT * queries.
      const arrayRows = convertRowsToArrays(sql, result.rows);
      return { rows: arrayRows };
    };
  }

  async exportDatabase(): Promise<Uint8Array> {
    const id = generateRequestId();
    const result = await this.sendRequest({ type: 'EXPORT', id });
    if (!isRecord(result) || !isNumberArray(result['data'])) {
      throw new Error('Unexpected export data from worker');
    }
    const data = result['data'];
    return new Uint8Array(data);
  }

  async importDatabase(data: Uint8Array): Promise<void> {
    const id = generateRequestId();
    await this.sendRequest({
      type: 'IMPORT',
      id,
      data: Array.from(data)
    });
  }

  async deleteDatabase(name: string): Promise<void> {
    // If worker is running, use it to delete the file
    if (this.worker && this.isReady) {
      const id = generateRequestId();
      await this.sendRequest({
        type: 'DELETE_DATABASE',
        id,
        name
      });
    } else {
      // Worker not running, delete OPFS file directly
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        const filename = `${name}.sqlite3`;
        try {
          await opfsRoot.removeEntry(filename);
        } catch {
          // File might not exist
        }
        // Also delete journal/WAL files
        for (const suffix of ['-journal', '-wal', '-shm']) {
          try {
            await opfsRoot.removeEntry(filename + suffix);
          } catch {
            // Ignore
          }
        }
      } catch {
        // OPFS not available or file doesn't exist
      }
    }
  }
}
