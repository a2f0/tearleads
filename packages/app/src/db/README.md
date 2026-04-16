# DB Folder

- `DatabaseProvider.tsx` owns the React-facing database lifecycle and exposes the active worker client through context.
- SQLite runtime and worker-thread plumbing live in `@tearleads/sqlite-worker`.
- Browser hosts can rely on the default module-worker runtime, which expects the host to serve a bundled worker at `/worker.js`.
- Non-browser or custom hosts should provide their own `createDatabaseRuntime` through `AppHostConfig`.
