# Session retry identity

[`SessionRetryIdentity.tla`](./SessionRetryIdentity.tla) checks that a delayed
401 for identity A never replays its request as identity B. Renewal for A,
including one completed by a concurrent request, may replay. A request whose
callers all retired without a sign-in change, as on an organization switch,
neither starts a renewal nor replays.

| Model action or predicate | Production seam |
| --- | --- |
| `Receive401` | `shouldRetryAfterSessionExpired` recognizes only a recorded renewal when the token has changed |
| `InstallRenewal` | `setAuthToken` changes the token and `SessionRenewalTracker.tokenChanged` increments its revision; a dishonest server may answer with another user's session |
| `CheckRenewedUser` | `runAuthentication` accepts a renewal only when the verified user matches the user whose session expired |
| `FinishRenewal` | `SessionRenewalTracker` records a renewal only if exactly one token transition occurred during its callback |
| `Dispatch` | `SessionRenewalTracker.currentToken` rechecks the recorded transition after awaiting renewal and host notification; `fetchResponseRequest` receives that captured token |
| `JoinRenewal` | `shouldRetryAfterSessionExpired` joins the pending promise for its original token, including the interval between token installation and callback completion |
| `RetryKeepsActor` | `makeResponseRequest` never replays an earlier request under an unrelated identity |
| `RetireCallers` | a caller's `stillCurrent` turns false; a shared writer-projection read retires when `SharedRequestScope.current` does, after every caller sharing it retired |
| `RecheckCallerScope` | `requestRetired` before `shouldRetryAfterSessionExpired` renews, and the `stillCurrent` check after renewal |
| `RetiredCallersNeitherRenewNorReplay` | `fetchResponseRequest` returns a cancellation for a retired caller instead of renewing or replaying |

Bounds are two actors, one renewal, one identity switch, and one observed request.
A concurrent request may initiate the renewal before this request receives its
401 response.
The renewal may install another user's session, as a dishonest server could
answer, so the same-user check is modeled rather than assumed; an honest
renewal must still replay (`HonestRenewalReplays` covers renewals that kept the
user). The model does not model token cryptography, server authorization, or
arbitrarily many renewals. Runtime tests cover logout, a switch during renewal,
and a switch in the renewal notification callback.

The caller's retirement is one abstract event: an organization switch or any
other reason its `stillCurrent` turns false. For a shared writer-projection
read, that event happens only after every caller sharing the read has
retired.

Negative controls remove the completion revision check or the dispatch check.
A third removes both changed-token checks, reproducing a blind retry.
A fourth disables joining a pending renewal and must fail the honest replay
invariant. A fifth drops the renewed-user check, so a renewal that installs
another user's session replays the request as that user. A sixth drops the
caller-scope recheck, so a request whose callers retired renews and replays.
Weak fairness requires a request to finish; an uninterrupted same-identity
renewal must successfully replay rather than satisfying safety by refusing all
retries.
