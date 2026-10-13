# Bounded document scheduling

[`SyncLaneConcurrency.tla`](./SyncLaneConcurrency.tla) models the scheduler
changed by #2512: three document lanes, one structural lane, and two workers.
The production pool has four workers; two exposes both overlap and saturation
with a smaller state space. Each lane can receive one additional request,
including during an active or watchdog-abandoned callback. One document can
fail and rearm once. Each callback can time out once without releasing its token.

| Model action or predicate | Production seam |
| --- | --- |
| `Start` / `BoundedWorkers` | `runRequestedSyncLanes` admits up to `DOCUMENT_LANE_CONCURRENCY` document callbacks |
| `StructuralBarrier` | `runRequestedSyncLanes` drains running documents before structural work and blocks new documents behind a structural request |
| `ExclusiveLane` / `Watchdog` | `activeRunToken` survives watchdog expiry in `runCoordinatorLane` and is cleared by `settleAbandonedSyncLaneRun` |
| `RequestOnce` / `TrailingRequestSurvives` | `requestLaneSync` coalesces a trailing request without completion clearing it |
| `Fail` / `BackoffIsLocal` | `backingOff` delays the failed lane while `selectNextRequestedLane` admits healthy peers |
| `Finish` / `AllLanesProgress` | `runCoordinatorLane` releases workers and wakes the pump; late callbacks retain exclusive ownership until settlement |

Safety checks cover capacity, the phase barrier at admission, lane exclusivity,
and preservation of a trailing request. Backoff locality is an eligibility
property, so it cannot pass just because a model assumes all timers finish.
Eventual quiescence also requires every trailing or retried request to settle.
Liveness assumes weak fairness of starting eligible work, callback settlement,
and backoff expiry, with the bounded requests/failure above. Watchdog tails may
overlap later phases; the barrier deliberately excludes abandoned callbacks,
matching the existing exception documented in client sync ordering.
Byte transfers separately enforce download idle and upload size-based deadlines;
aborted results are discarded. Runtime regressions cover the permit lifecycle
outside this model.

Six negative controls disable the worker cap, phase barrier, exclusive token,
trailing request retention, backoff isolation, or timer expiry and require the corresponding
property to fail. Runtime regressions in the coordinator concurrency and watchdog
tests exercise those production seams.

The model abstracts timestamps, dynamic lane registration, disposal, priority
ranking, byte transfers, and document/SQL/cryptographic behavior. It does not
model pump teardown, wake-up delivery, or the `hasRunnableLaneWork` restart
check; runtime regressions cover those mechanisms. Negative controls mutate
model guards, so they establish property sensitivity within this abstraction,
not automatic detection of arbitrary implementation faults. It is not a
throughput proof or a guarantee of progress through permanent network failure.
The single-document RestartProbeConvergence model and its implementation trace
projection retain their per-document exclusive-probe contract; concurrent
independent document lanes do not change that abstraction. Attachment hydration
continues to honor its intent and generation checks.
