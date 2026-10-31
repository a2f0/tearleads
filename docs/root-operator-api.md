# Root Operator API

The `/root` routes serve internal staff and technical support only. They are
registered in the protocol operation registry and the generated OpenAPI
contract, so the root console reaches them through the typed client; access is
enforced by the API, never by the client.

## Routes

| Capability | Route |
| --- | --- |
| List platform identities (newest first, cursor paged; optional filters: `fingerprint`, the first 8–64 lowercase hex characters of a signing key fingerprint, exact `userId`, and `rootOnly`) | `GET /root/identities` |
| Get one identity with its last activity and live sessions | `GET /root/identities/:userId` |
| List an identity's organizations with roster status, sync pause, seat holding, and billing standing | `GET /root/identities/:userId/organizations` |
| Page platform organizations newest first, optionally narrowed to one exact organization ID (names are encrypted, so there is no name search) | `GET /root/organizations` |
| Read an organization's group bindings, roster and open-seat counts, persisted billing (including purge progress), Stripe binding and latest 50 billing events | `GET /root/organizations/:organizationId` |
| Page an organization's roster identities, including disabled entries, with each member's sync pause and seat holding | `GET /root/organizations/:organizationId/identities` |
| Read an organization's synced data usage | `GET /root/organizations/:organizationId/data-usage` |
| Page synced data usage by organization, newest organizations first, with the same exact-ID filter | `GET /root/reports/data-usage` |
| Report billing maintenance trouble across organizations: failing, overdue or lapsed-lease Stripe seat syncs, failed or overdue trial expiries, overdue or lapsed purges, and trials ending and purges falling due within seven days (each section capped at 50 rows) | `GET /root/reports/ops-health` |
| Page an organization's stored RevenueCat webhook deliveries newest first by event time, whatever their outcome: those resolved to it (`role: target`) and the `TRANSFER`s that moved a purchase away from it (`role: source`) | `GET /root/organizations/:organizationId/revenuecat-events` |
| Page RevenueCat deliveries across organizations that resolved to none or that the handler ignored (`disposition`: `unmatched`, `ignored`, or `both`) | `GET /root/reports/revenuecat-events` |
| Page recorded operator actions newest first, optionally only those involving one identity or organization (`subjectId`) | `GET /root/audit-events` |
| Suspend a non-root identity: refuse its sign-in and revoke every live session (409 for a root identity) | `PUT /root/identities/:userId/suspension` |
| Lift a suspension so the identity's devices can sign in again | `DELETE /root/identities/:userId/suspension` |

## Root access

These routes run `requireAuth` then `requireRoot`, which admits only identities
whose `users.is_root` flag is set. The flag is an operational boolean for
internal staff and technical support, granted and revoked with the API CLI's
`make-admin` / `revoke-admin` commands; it carries no access-plane keys.
`users.last_active_at` is written by the session middleware's throttled
activity path so operators can see when an identity was last seen.

## Audit trail

Every root handler records a `root_audit_events` row — actor, operation id,
target identity or organization, applied filters, and request IP — before it
reads or changes anything it serves. A listing narrowed by an exact identifier
(a user ID, a full signing key fingerprint, an organization ID search, or an
audit-trail subject) names that identity or organization as its target, so it
appears in that subject's audit trail. A request whose row cannot be written
fails with a 500 instead of being answered unrecorded, and a suspension it
carried is not applied; requests refused by `requireAuth` or `requireRoot`
record nothing, while a suspension the route itself refuses is still recorded.
The CLI's `make-admin` / `revoke-admin` record each change to `users.is_root`
in the same table, with no actor, in the transaction that changes the flag.

## Account suspension

Suspension sets `users.suspended_at`, then revokes the identity's live
sessions. `POST /auth/verify` refuses a suspended identity's valid signature
with 403 and code `account_suspended`, which clients treat as terminal rather
than renewing. Verify re-reads the flag after it stores the new session and
revokes that session if a suspension committed meanwhile, so a sign-in racing
the sweep cannot survive it. A sweep that fails answers 500 and can be
repeated; meanwhile `requireAuth` re-reads `users.suspended_at` on its
throttled activity path (about once a minute per session), in the same
statement that stamps `users.last_active_at` for an unsuspended identity, so a
session the sweep missed is refused within one activity interval. A failed
check fails the request rather than admitting it. Websocket ticket upgrades
and session liveness rechecks read the same flag, so a missed session's
sockets close on their next check.
