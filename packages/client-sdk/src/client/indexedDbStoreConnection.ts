interface IndexedDbStoreConnectionOptions {
  readonly databaseName: string;
  readonly indexedDB: IDBFactory;
  readonly keyPath: string;
  readonly objectStoreName: string;
}

function indexedDbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function indexedDbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };
    transaction.oncomplete = () => {
      resolve();
    };
  });
}

async function runIndexedDbRequest<T>(
  transaction: IDBTransaction,
  request: IDBRequest<T>,
): Promise<T> {
  const transactionDone = indexedDbTransactionDone(transaction);
  try {
    const [result] = await Promise.all([
      indexedDbRequest(request),
      transactionDone,
    ]);
    return result;
  } catch (error) {
    await transactionDone.catch(() => undefined);
    throw error;
  }
}

export class IndexedDbStoreConnection {
  private readonly activeTransactions = new Set<IDBTransaction>();
  private readonly options: IndexedDbStoreConnectionOptions;
  private closed = false;
  private database: IDBDatabase | null = null;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbStoreConnectionOptions) {
    this.options = options;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    for (const transaction of this.activeTransactions) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed between iteration and abort.
      }
    }
    this.activeTransactions.clear();

    const database = this.database;
    database?.close();
    this.database = null;
    const databasePromise = this.databasePromise;
    this.databasePromise = null;
    if (!database) {
      void databasePromise?.then(
        (openedDatabase) => openedDatabase.close(),
        () => undefined,
      );
    }
  }

  async request<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    this.assertOpen();
    const database = await this.openDatabase();
    this.assertOpen();
    const transaction = database.transaction(
      this.options.objectStoreName,
      mode,
    );
    this.activeTransactions.add(transaction);
    try {
      const store = transaction.objectStore(this.options.objectStoreName);
      return await runIndexedDbRequest(transaction, operation(store));
    } finally {
      this.activeTransactions.delete(transaction);
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("IndexedDB connection is closed.");
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    this.assertOpen();
    if (this.databasePromise) {
      return this.databasePromise;
    }

    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.options.indexedDB.open(this.options.databaseName, 1);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error("IndexedDB open failed."));
      };
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.options.objectStoreName)) {
          database.createObjectStore(this.options.objectStoreName, {
            keyPath: this.options.keyPath,
          });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (this.closed) {
          database.close();
          reject(new Error("IndexedDB connection is closed."));
          return;
        }
        this.database = database;
        database.onversionchange = () => {
          database.close();
          if (this.database === database) {
            this.database = null;
            this.databasePromise = null;
          }
        };
        resolve(database);
      };
    });

    return this.databasePromise;
  }
}
