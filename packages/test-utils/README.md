# Shared test utilities

This package is test support. Production code must not import it.

## Transport fault harness

`createTransportFaultHarness` runs a strict sequence of fetch requests. Each step
matches an exact method and complete URL, including the origin and query. The
harness never falls back to a live network. It can:

- Throw a network error before a request reaches the supplied delegate.
- Forward a request to an in-process server or another explicit delegate.
- Lose the response after the delegate finishes, modeling a commit whose
  acknowledgment never reached the client.
- Return a chosen response, including HTTP errors or malformed bodies.
- Pause requests at explicit gates to control completion order without sleeps.

```ts
import { createTransportFaultHarness } from "@tearleads/test-utils";

const harness = createTransportFaultHarness({
  steps: [
    {
      name: "offline",
      method: "GET",
      url: "https://api.test/",
      action: { kind: "network-error" },
    },
    {
      name: "recovered",
      method: "GET",
      url: "https://api.test/",
      action: {
        kind: "response",
        response: () => Response.json({ message: "ok" }),
      },
    },
  ],
});
await harness.run(async () => {
  await client.getHealth();
  await client.getHealth();
});
```

`run` temporarily installs the scripted global fetch, restores it in `finally`,
and checks that every step ran and every request settled. Unexpected requests and
delegate errors fail this check even if a client caught their exceptions.
Each outcome must also match its action: forwarding and chosen responses expect
`response`, while network errors and lost responses expect their respective
faults. Set a step's `expectedOutcome: "aborted"` for intentional cancellation;
an abort cannot silently stand in for a fault the test never exercised.
Global scopes must run serially; overlapping harness scopes are rejected. Await
all requests inside the callback. Cleanup aborts requests paused at gates and
signals cancellation to delegates, which must honor the request's signal.
Unrelated code that changes global fetch must not run concurrently with a scope.

For explicit fetch injection, use `harness.fetch` directly and call
`harness.assertComplete()` after awaiting the requests. This requires no global
scope and permits independent harnesses to run concurrently.

`createTransportGate()` returns `entered`, `release()`, and `wait(signal)`. Attach
the gate to a step, start a request, await `gate.entered`, inspect intermediate
state, then call `gate.release()` and await the request. Abort signals also
release a blocked request by rejecting it. Steps are consumed at request entry,
so multiple gates can complete in a different order from the request script.

`harness.attempts` returns snapshots of request order, step names, methods, URLs,
outcomes, response statuses, and errors. It does not capture bodies or headers.
The harness models transport behavior; a lost response does not itself implement
server idempotency. Test that behavior with the actual server delegate.

Run focused coverage and the SDK consumer with:

```sh
bun run check:package @tearleads/test-utils
bun run check:package @tearleads/client-sdk --test-name-pattern 'Network reachability'
```
