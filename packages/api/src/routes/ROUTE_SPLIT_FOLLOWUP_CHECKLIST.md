# Route Split Follow-Up Checklist (#1500)

Goal: finish the one-endpoint-per-file refactor by moving endpoint handler implementations out of aggregator route files and into their route-specific files.

## Completed in this pass
- [x] `auth`: handlers moved to `routes/auth/*`, `auth.ts` is now router assembly only.
- [x] `chat`: handler moved to `routes/chat/post-completions.ts`, `chat.ts` is now router assembly only.
- [x] `sse`: handler moved to `routes/sse/get-root.ts`, `sse.ts` is now router assembly only.
- [x] `vfs`: handlers moved to `routes/vfs/*`, `vfs.ts` is now router assembly only.
- [x] `emails`: handlers moved to `routes/emails/*`, `emails.ts` is now router assembly only.

## Remaining
- [ ] `mls`: move 18 handler implementations from `mls.ts` into `routes/mls/*`.
- [ ] `ai-conversations`: move 9 handler implementations into `routes/ai-conversations/*`.
- [ ] `vfs-shares`: move 7 handler implementations into `routes/vfs-shares/*`.
- [ ] `admin/groups`: move 8 handler implementations into `routes/admin/groups/*`.
- [ ] `admin/organizations`: move 7 handler implementations into `routes/admin/organizations/*`.
- [ ] `admin/postgres`: move 4 handler implementations into `routes/admin/postgres/*`.
- [ ] `admin/redis`: move 4 handler implementations into `routes/admin/redis/*`.
- [ ] `admin/users`: move 3 handler implementations into `routes/admin/users/*`.
- [ ] `emailsCompose`: move 5 handler implementations into `routes/emailsCompose/*`.

## Validation for each module
- [ ] Module tests pass (existing route test files).
- [ ] OpenAPI output unchanged for moved endpoints.
- [ ] Parent router file contains only imports + route registration.
