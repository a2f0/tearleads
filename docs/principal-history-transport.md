# Principal-policy history transport

The principal-policy GET route returns at most 32 historical entries per page,
plus the artifacts for one pinned signed head. The initial request chooses the
current head; subsequent requests send its `stateHash` and the returned
`historyPage.nextAfterVersion` as `afterVersion`. A null next cursor means the
entire prefix before that head has been delivered. A later policy update does
not move the requested pin. Every page rechecks current read authorization and
verifies the current policy before reading historical data; historical membership
does not restore revoked access. Each returned historical entry is checked
against the server's locally authenticated prefix and inclusion index.

The API client rejects head/artifact changes, gaps, reordered entries, repeated
cursors, and premature completion. Its authentication and cancellation context
spans the entire download. It currently collects these wire pages into the SDK's
existing full bundle, which the SDK still verifies cryptographically. This
bounds history depth per HTTP response, but does not yet bound total client
memory or provide durable client resume. SDK staging and other embedded-history
responses remain separate work for #2442 / #2448. The generated OpenAPI artifacts
and response-export barrel budgets include the new page and cursor contract.

`ApiClient.getPrincipalPolicyPages` exposes the same validated transport as a
pull-based async iterator. It can select an exact `stateHash` on its first request
or resume with saved current artifacts and an `afterVersion`. Those inputs are
transport hints; the API client does not authenticate the omitted prefix. It
retains a private copy of the pin, does not prefetch while a consumer is working,
and checks cancellation and identity changes after the consumer resumes.

The SDK's `recoverPrincipalPolicyHistory` uses that iterator with the streaming
crypto verifier and durable `principal_history_stages` rows. Each row contains
checked progress, retained references, and its transport position. A caller-owned
local key authenticates the row's head, current artifacts, cursor, completion
state, organization, trust context, checkpoint, and reference selection. The
transaction checks the prior progress before replacing it and gates commit on
the caller's current operation. Invalid or missing progress is disposable and
recovered from signed history. The returned sparse current-policy capability does
not advance a trusted application checkpoint. Existing bundle-based consumers
still need integration with this recovery path.
