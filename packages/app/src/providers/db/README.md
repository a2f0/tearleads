# DB Provider

- `DatabaseProvider.tsx` owns the React-facing database lifecycle and exposes
  the active worker client through context.
- Host-facing SQLite runtime contracts and factories come from `@tearleads/client-sdk/sqlite`.
- Worker-thread plumbing still lives in `@tearleads/sqlite-worker` behind the
  SDK facade.
- Browser hosts can rely on the default module-worker runtime, which expects the
  host to serve a bundled worker at `/worker.js`.
- Non-browser or custom hosts should provide their own `createSQLiteRuntime`
  through `AppHostConfig`.
