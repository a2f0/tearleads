# Route Split Follow-Up Checklist (#1500)

Goal: finish the one-endpoint-per-file refactor by moving endpoint handler implementations out of aggregator route files and into their route-specific files.

## Completed in this pass

- [x] `auth`: handlers moved to `routes/auth/*`, `auth.ts` is now router assembly only.
- [x] `chat`: handler moved to `routes/chat/post-completions.ts`, `chat.ts` is now router assembly only.
- [x] `sse`: handler moved to `routes/sse/get-root.ts`, `sse.ts` is now router assembly only.
- [x] `vfs`: handlers moved to `routes/vfs/*`, `vfs.ts` is now router assembly only.
- [x] `emails`: handlers moved to `routes/emails/*`, `emails.ts` is now router assembly only.
- [x] `emailsCompose`: handlers moved to `routes/emailsCompose/*`, `emailsCompose.ts` is now router assembly only.
- [x] `admin/users`: handlers moved to `routes/admin/users/*`, `admin/users.ts` is now router assembly only.
- [x] `admin/redis`: handlers moved to `routes/admin/redis/*`, `admin/redis.ts` is now router assembly only.
- [x] `admin/postgres`: handlers moved to `routes/admin/postgres/*`, `admin/postgres.ts` is now router assembly only.
- [x] `admin/organizations`: handlers moved to `routes/admin/organizations/*`, `admin/organizations.ts` is now router assembly only.
- [x] `admin/groups`: handlers moved to `routes/admin/groups/*`, `admin/groups.ts` is now router assembly only.
- [x] `vfs-shares`: handlers moved to `routes/vfs-shares/*`, `vfs-shares.ts` is now router assembly only.
- [x] `ai-conversations`: handlers moved to `routes/ai-conversations/*`, `ai-conversations.ts` is now router assembly only.
- [x] `mls`: handlers moved to `routes/mls/*`, `mls.ts` is now router assembly only.

## Remaining
- [x] None.

## Validation for each module

- [ ] Module tests pass (existing route test files).
- [ ] OpenAPI output unchanged for moved endpoints.
- [ ] Parent router file contains only imports + route registration.
