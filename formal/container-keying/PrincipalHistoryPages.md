# Principal history page verification

[`PrincipalHistoryPages.tla`](./PrincipalHistoryPages.tla) models the crypto
verifier's publication of a checked prefix across page boundaries. A page stages
its entries and external-authority citations privately. Failed checks cannot
advance the published prefix. An uncited page cannot erase a previously observed
external-authority head and thereby permit a later rollback.

| Model action or predicate | Production seam |
| --- | --- |
| `Stage` | `verifyPrincipalHistoryPage` owns and validates the incoming page before returning its staged result |
| `Accept` | `PrincipalPolicyHistoryVerifier.append` publishes the predecessor and authority only after the entire page succeeds |
| `Reject` | `runVerifier` returns an error while the verifier retains its previous progress |
| `AuthorityProgress` | `verifyPrincipalPolicyExternalAuthorityProgress` compares each citation against the last observed authority, including across uncited pages |

The negative controls publish progress before checking a page, or forget the
previous authority on an uncited page. They must violate
`OnlyCheckedPagesAdvance` and `AuthorityProgress`, respectively. The latter is a
strong invariant: losing the head is already a failure, before a later stale
citation uses it.

Cryptographic validity, commitment checks, per-page byte budgets, checkpoint
connection, exact-head matching, and server/client storage are outside this
model. Real signed crypto tests exercise the corresponding verifier checks and
prove their regressions with disabled checks. This model makes no HTTP latency,
durable-resumption, or atomic application-mutation guarantee; those require the
transport and storage integration tracked in #2448.
