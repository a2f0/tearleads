# API Zod Migration

This temporary checklist tracks canonical Zod operation coverage for every
distinct HTTP method and path exposed by `packages/api`. An endpoint is complete
only when shared schemas own its request inputs, success response, documented
error responses, API route validation, API-client metadata, and OpenAPI entry.

Current coverage: **56 of 58 operations**.

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

- [x] `GET /blobs/:blobId/bytes`
- [x] `POST /blobs/:blobId/attachment-bindings`
- [x] `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`
- [x] `POST /blobs/stages/multipart`
- [x] `GET /blobs/stages/multipart/:stageId`
- [x] `POST /blobs/stages/multipart/:stageId/complete`
- [x] `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes`

## Containers

- [x] `POST /containers`
- [x] `DELETE /containers/:containerId`
- [x] `GET /containers/:containerId/documents`
- [x] `GET /containers/:containerId/kek-log`
- [x] `POST /containers/:containerId/move`
- [x] `POST /containers/:containerId/rekey`
- [x] `POST /containers/:containerId/revoke`
- [x] `POST /containers/:containerId/share`
- [x] `GET /containers/:containerId/writer-projection`
- [x] `POST /containers/parent-lanes/query`
- [x] `POST /containers/with-metadata-document`

## Documents

- [x] `POST /documents`
- [x] `DELETE /documents/:documentId`
- [x] `GET /documents/:documentId/attachments`
- [x] `GET /documents/:documentId/attribution`
- [x] `GET /documents/:documentId/attribution/ranges`
- [x] `POST /documents/:documentId/link`
- [x] `POST /documents/:documentId/sync`
- [x] `POST /documents/:documentId/unlink`
- [x] `GET /documents/:documentId/writer-projection`

## Billing

- [ ] `POST /billing/revenuecat/webhook`
- [ ] `POST /billing/stripe/webhook`
- [x] `GET /organizations/:organizationId/billing`
- [x] `GET /organizations/:organizationId/billing/history`
- [x] `GET /organizations/:organizationId/billing/management-url`
- [x] `POST /organizations/:organizationId/billing/native/:store/claim`
- [x] `POST /organizations/:organizationId/billing/stripe/cancel`
- [x] `POST /organizations/:organizationId/billing/stripe/checkout`
- [x] `POST /organizations/:organizationId/billing/stripe/checkout-session`
- [x] `GET /organizations/:organizationId/billing/stripe/options`
- [x] `POST /organizations/:organizationId/billing/stripe/portal`
- [x] `POST /organizations/:organizationId/billing/trial`

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
