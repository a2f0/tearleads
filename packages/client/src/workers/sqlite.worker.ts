/**
 * SQLite Web Worker using official SQLite WASM with encryption support.
 * Uses SQLite3MultipleCiphers for at-rest encryption with OPFS storage.
 *
 * This is the main worker entry point. Database initialization, VFS management,
 * and operations are split into separate modules in ./sqlite/ for maintainability.
 */

/// <reference lib="webworker" />

import {
  closeDatabase,
  getCurrentDbFilename,
  getDb,
  getEncryptionKey,
  getSqlite3,
  initializeDatabase,
  setDb,
  setEncryptionKey
} from './sqlite/init';
import {
  beginTransaction,
  commit,
  deleteDatabaseFile,
  execute,
  executeMany,
  exportDatabase,
  importDatabase,
  rekey,
  rollback
} from './sqlite/operations';
import type { WorkerRequest, WorkerResponse } from './sqlite.worker.interface';

/**
 * Send a response to the main thread.
 */
function respond(response: WorkerResponse): void {
  self.postMessage(response);
}

/**
 * Handle messages from the main thread.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'INIT': {
        await initializeDatabase(
          request.config.name,
          new Uint8Array(request.config.encryptionKey)
        );
        respond({ type: 'INIT_SUCCESS', id: request.id });
        break;
      }

      case 'EXECUTE': {
        const result = execute(getDb(), request.query);
        respond({ type: 'RESULT', id: request.id, data: result });
        break;
      }

      case 'EXECUTE_MANY': {
        executeMany(getDb(), request.statements);
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'BEGIN_TRANSACTION': {
        beginTransaction(getDb());
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'COMMIT': {
        commit(getDb());
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'ROLLBACK': {
        rollback(getDb());
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'REKEY': {
        rekey(getDb(), new Uint8Array(request.newKey), setEncryptionKey);
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'EXPORT': {
        const exportData = exportDatabase(getDb(), getSqlite3());
        respond({
          type: 'EXPORT_RESULT',
          id: request.id,
          data: Array.from(exportData)
        });
        break;
      }

      case 'IMPORT': {
        importDatabase(
          new Uint8Array(request.data),
          getSqlite3(),
          getEncryptionKey(),
          getCurrentDbFilename(),
          setDb
        );
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'CLOSE': {
        closeDatabase();
        respond({ type: 'CLOSED', id: request.id });
        break;
      }

      case 'DELETE_DATABASE': {
        closeDatabase();
        await deleteDatabaseFile(request.name);
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorResponse: WorkerResponse = {
      type: 'ERROR',
      id: 'id' in request ? request.id : 'unknown',
      error: message
    };
    respond(errorResponse);
  }
};

// Signal that the worker is ready
respond({ type: 'READY' });
