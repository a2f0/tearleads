# API Zod Migration

This temporary checklist tracks canonical Zod operation coverage for every
distinct HTTP method and path exposed by `packages/api`. An endpoint is complete
only when shared schemas own its request inputs, success response, documented
error responses, API route validation, API-client metadata, and OpenAPI entry.

Current coverage: **23 of 58 operations**.

## Health

- [x] `GET /`

## Authentication

- [x] `POST /auth/challenge`
- [x] `POST /auth/logout`
- [x] `POST /auth/register`
- [x] `GET /auth/sessions`
- [x] `DELETE /auth/sessions/:sessionId`
- [x] `GET /auth/user-identity/:userId`
- [x] `POST /auth/verify`
- [x] `POST /auth/ws-ticket`

## Blobs

- [ ] `GET /blobs/:blobId/bytes`
- [x] `POST /blobs/:blobId/attachment-bindings`
- [x] `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`
- [ ] `POST /blobs/stages/multipart`
- [ ] `GET /blobs/stages/multipart/:stageId`
- [ ] `POST /blobs/stages/multipart/:stageId/complete`
- [ ] `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes`

## Containers

- [ ] `POST /containers`
- [ ] `DELETE /containers/:containerId`
- [ ] `GET /containers/:containerId/documents`
- [ ] `GET /containers/:containerId/kek-log`
- [ ] `POST /containers/:containerId/move`
- [ ] `POST /containers/:containerId/rekey`
- [ ] `POST /containers/:containerId/revoke`
- [ ] `POST /containers/:containerId/share`
- [ ] `GET /containers/:containerId/writer-projection`
- [ ] `POST /containers/parent-lanes/query`
- [ ] `POST /containers/with-metadata-document`

## Documents

- [ ] `POST /documents`
- [ ] `DELETE /documents/:documentId`
- [x] `GET /documents/:documentId/attachments`
- [ ] `GET /documents/:documentId/attribution`
- [ ] `GET /documents/:documentId/attribution/ranges`
- [ ] `POST /documents/:documentId/link`
- [x] `POST /documents/:documentId/sync`
- [ ] `POST /documents/:documentId/unlink`
- [ ] `GET /documents/:documentId/writer-projection`

## Billing

- [ ] `POST /billing/revenuecat/webhook`
- [ ] `POST /billing/stripe/webhook`
- [ ] `GET /organizations/:organizationId/billing`
- [ ] `GET /organizations/:organizationId/billing/history`
- [ ] `GET /organizations/:organizationId/billing/management-url`
- [ ] `POST /organizations/:organizationId/billing/native/:store/claim`
- [ ] `POST /organizations/:organizationId/billing/stripe/cancel`
- [ ] `POST /organizations/:organizationId/billing/stripe/checkout`
- [ ] `POST /organizations/:organizationId/billing/stripe/checkout-session`
- [ ] `GET /organizations/:organizationId/billing/stripe/options`
- [ ] `POST /organizations/:organizationId/billing/stripe/portal`
- [ ] `POST /organizations/:organizationId/billing/trial`

## Organizations

- [x] `POST /organizations`
- [x] `GET /organizations/:organizationId/data-usage`
- [x] `POST /organizations/:organizationId/groups`
- [x] `DELETE /organizations/:organizationId/groups/:groupId`
- [x] `GET /organizations/:organizationId/groups/:groupId/members`
- [x] `PUT /organizations/:organizationId/profile`
- [x] `GET /organizations/:organizationId/read-model`
- [x] `PUT /organizations/:organizationId/roster/:userId`

## Principals

- [x] `GET /principals/:principalType/:principalId/policy`
- [x] `PUT /principals/:principalType/:principalId/policy`
