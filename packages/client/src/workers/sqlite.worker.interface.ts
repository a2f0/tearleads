/**
 * SQLite Web Worker message types.
 * Defines the communication protocol between main thread and worker.
 */

export interface QueryParams {
  sql: string;
  params?: unknown[];
  method?: 'all' | 'get' | 'run';
}

export interface QueryResultData {
  rows: Record<string, unknown>[];
  changes?: number;
  lastInsertRowId?: number;
}

// Request messages (main thread -> worker)
export type WorkerRequest =
  | {
      type: 'INIT';
      id: string;
      config: {
        name: string;
        encryptionKey: number[]; // Uint8Array converted to array for transfer
      };
    }
  | {
      type: 'EXECUTE';
      id: string;
      query: QueryParams;
    }
  | {
      type: 'EXECUTE_MANY';
      id: string;
      statements: string[];
    }
  | {
      type: 'BEGIN_TRANSACTION';
      id: string;
    }
  | {
      type: 'COMMIT';
      id: string;
    }
  | {
      type: 'ROLLBACK';
      id: string;
    }
  | {
      type: 'REKEY';
      id: string;
      newKey: number[];
    }
  | {
      type: 'EXPORT';
      id: string;
    }
  | {
      type: 'IMPORT';
      id: string;
      data: number[]; // Uint8Array as array for transfer
    }
  | {
      type: 'CLOSE';
      id: string;
    };

// Response messages (worker -> main thread)
export type WorkerResponse =
  | {
      type: 'READY';
    }
  | {
      type: 'INIT_SUCCESS';
      id: string;
    }
  | {
      type: 'RESULT';
      id: string;
      data: QueryResultData;
    }
  | {
      type: 'SUCCESS';
      id: string;
    }
  | {
      type: 'ERROR';
      id: string;
      error: string;
      stack?: string;
    }
  | {
      type: 'EXPORT_RESULT';
      id: string;
      data: number[]; // Uint8Array as array for transfer
    }
  | {
      type: 'CLOSED';
      id: string;
    };

/**
 * Generate a unique request ID.
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
