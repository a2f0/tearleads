# RFC: Greenfield E2EE Inbound SMTP -> VFS

## Status

- Draft

## Goals

- Deliver inbound SMTP messages into VFS-backed email data paths.
- Enforce canonical recipient routing as `<users.id>@<accepted-domain>`.
- Encrypt inbound payloads before durable persistence.
- Treat this work as greenfield (no legacy plaintext compatibility).

## Non-Goals

- Legacy alias compatibility.
- IMAP parity in this phase.
- Migrating existing Redis plaintext records.

## High-Level Architecture

- `@tearleads/smtp-listener`:
  - SMTP protocol handling and recipient validation.
  - Streams inbound MIME payload and dispatches to ingest pipeline.
- Ingest pipeline (new work):
  - Resolve recipients to canonical user IDs.
  - Fetch recipient VFS public encryption keys.
  - Encrypt message blob once and wrap content key per recipient.
  - Persist encrypted blob and VFS metadata.
- Data stores:
  - Blob ciphertext in Garage/S3-compatible object storage.
  - Metadata/indexes in Postgres, aligned with VFS email/folder models.

## Recipient Resolution

- Domain must be in `SMTP_RECIPIENT_DOMAINS` when configured.
- Local-part must be canonical UUID (`users.id`) by default.
- Non-UUID local-part support is available only as explicit opt-in (`legacy-local-part`) for local testing.

## Encryption Envelope (Proposed)

- One random content key (DEK) per message.
- MIME body encrypted once with AEAD (AES-GCM).
- Per recipient:
  - Wrap DEK using recipient `user_keys.public_encryption_key`.
  - Store wrapped envelope fields + key algorithm metadata.

## Persistence Model (Proposed)

- VFS integration:
  - Ensure system Inbox exists for recipient.
  - Create/link VFS email item under Inbox with encrypted fields and blob reference.
  - Persist recipient key envelope access in `vfs_acl_entries`.

## SMTP Transaction Semantics

- Reject invalid recipients during RCPT (`550`).
- ACK DATA (`250`) only after blob + DB writes succeed.
- Return transient failure (`451`) for encryption/store errors.

## Phased Implementation Plan

1. Routing and validation foundation.
1. Ingest interfaces for key lookup, blob write, and VFS email writes.
1. End-to-end encrypted ingest for single recipient.
1. Multi-recipient fanout with atomic DB writes.
1. API/client read-path integration for encrypted inbound messages.
1. Hardening: retries, metrics, and failure-mode testing.

## Initial Iteration Implemented

- Added UUID-first recipient resolution to SMTP listener (`uuid-local-part` default).
- Added explicit addressing mode in listener config (`uuid-local-part` or `legacy-local-part`).
- Added tests for UUID acceptance, malformed recipient handling, domain filtering, and legacy opt-in mode.
