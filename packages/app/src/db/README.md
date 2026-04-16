# DB Folder

- `DatabaseProvider.tsx` owns the React-facing database lifecycle and exposes the active worker client through context.
- `worker/createAppDatabaseWorker.ts` builds the default browser-host wrapper around the database worker and expects the host to serve it at `/worker.js`.
- `worker/createModuleWorker.ts` is the low-level module-worker helper used by the app and by test/host-specific worker factories.
- `worker/databaseWorkerThread.ts` is the worker-thread entrypoint that initializes SQLite once and handles execute requests.
- `worker/types.ts` contains the small set of worker-related types shared across the provider, host config, and worker factories.
- Non-browser hosts should provide their own `createWorker` through `AppHostConfig` instead of relying on the default `/worker.js` path.
