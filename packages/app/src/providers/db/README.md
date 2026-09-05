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
- Local backups support password encryption or an unencrypted JSON payload.
  Restore detects the format and validates the same versioned payload in both
  cases. `localBackupFormat.ts` handles file encoding and encryption;
  `localBackupPayload.ts` owns the payload types and validation.
