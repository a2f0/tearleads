# DB Folder

- `DatabaseProvider.tsx` owns the React-facing database lifecycle and exposes the active worker client through context.
- `worker/createAppDatabaseWorker.ts` builds the main-thread wrapper around the database worker.
- `worker/createModuleWorker.ts` is the low-level module-worker helper used by the app and by test/host-specific worker factories.
- `worker/databaseWorkerThread.ts` is the worker-thread entrypoint that initializes SQLite once and handles execute requests.
- `worker/types.ts` contains the small set of worker-related types shared across the provider, host config, and worker factories.
