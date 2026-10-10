# Session retry identity

[`SessionRetryIdentity.tla`](./SessionRetryIdentity.tla) covers issue #2485
finding 3. A delayed 401 for identity A must never replay its request as identity
B. Renewal for A, including one completed by a concurrent request, may replay.

| Model action or predicate | Production seam |
| --- | --- |
| `Receive401` | `shouldRetryAfterSessionExpired` recognizes only a recorded renewal when the token has changed |
| `InstallRenewal` | `setAuthToken` changes the token and increments `authRevision`; the trusted renewal callback authenticates the same identity |
| `FinishRenewal` | `renewSession` records a renewal only if exactly one token transition occurred during its callback |
| `Dispatch` | `currentRenewalToken` rechecks the recorded transition after awaiting renewal and host notification; `fetchResponseRequest` receives that captured token |
| `RetryKeepsActor` | `makeResponseRequest` never replays an earlier request under an unrelated identity |

Bounds are two actors, one renewal, one identity switch, and one request.
The model treats the trusted renewal callback's same-identity authentication as
an assumption. It does not model token cryptography, server authorization, or
arbitrarily many renewals. Runtime tests cover logout, a switch during renewal,
and a switch in the renewal notification callback.

Negative controls remove the completion revision check or the dispatch check.
A third removes both changed-token checks to reproduce the original blind retry.
Weak fairness requires a request to finish; an uninterrupted same-identity
renewal must successfully replay rather than satisfying safety by refusing all
retries.
