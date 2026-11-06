# Patterns

Before and after shapes per language. Match the repository's existing names
(tag field, reducer file layout, error helpers) over these.

## TypeScript and React

Before: three booleans and two nullable fields, eight combinations, four valid.

```ts
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<Error | null>(null);
const [data, setData] = useState<Item[] | null>(null);
```

After: one union, one reducer, booleans derived for readers.

```ts
export type LoadState =
  | { status: "idle" }
  | { status: "loading"; request: number }
  | { status: "failed"; error: Error }
  | { status: "loaded"; items: Item[] };

export type LoadEvent =
  | { type: "start"; request: number }
  | { type: "succeed"; request: number; items: Item[] }
  | { type: "fail"; request: number; error: Error }
  | { type: "reset" };

/** Only the request that is still current may finish the load. */
const current = (state: LoadState, request: number) =>
  state.status === "loading" && state.request === request;

export function transition(state: LoadState, event: LoadEvent): LoadState {
  switch (event.type) {
    case "start":
      return { status: "loading", request: event.request };
    case "succeed":
      return current(state, event.request) ? { status: "loaded", items: event.items } : state;
    case "fail":
      return current(state, event.request) ? { status: "failed", error: event.error } : state;
    case "reset":
      return { status: "idle" };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(value)}`);
}

// In the component:
const [state, dispatch] = useReducer(transition, { status: "idle" });
const isLoading = state.status === "loading";
// Keyed on the request, not just the status, so a replacement request starts.
const request = state.status === "loading" ? state.request : undefined;
useEffect(() => {
  if (request === undefined) return;
  const abort = new AbortController();
  // The cleanup's own abort rejects the fetch; that rejection must not
  // dispatch, or a re-run of this effect for the same request (Strict Mode,
  // a dependency change) records a failure the user never had.
  let active = true;
  fetchItems(abort.signal).then(
    items => { if (active) dispatch({ type: "succeed", request, items }); },
    error => { if (active) dispatch({ type: "fail", request, error }); },
  );
  return () => { active = false; abort.abort(); };
}, [request]);
```

The request tag rejects results from a superseded request; the `active` flag
rejects callbacks from a cleaned-up effect for the same request. Keep both, and
test the replay: mount, unmount, mount again (Strict Mode), then resolve, and
expect `loaded`, not `failed`.

- Never drop a cancellation guard without replacing it. A bare
  `status === "loading"` check accepts a stale result in
  `start(A) -> reset -> start(B) -> succeed(A)`; tag each request (a counter
  or the `AbortController` itself) and let only the current one finish, as
  above, with that sequence as a test. Keep aborting the network work too.
- Stores (Zustand, Redux, signals): keep the union as the store's state and
  the reducer as its only writer; actions dispatch events.
- Classes and long-lived loops (sync workers, socket connections): a private
  `state` field of the union type, a `send(event)` method that applies
  `transition`, and the loop `switch`es on `state.status`.
- Server status columns: a `ALLOWED: Record<Status, readonly Status[]>` table
  and one `moveTo(row, next)` that checks it inside the update's transaction
  (`UPDATE ... WHERE status = $from`), so concurrent writers cannot skip a
  state.

Test with a table:

```ts
test.each([
  [{ status: "idle" }, { type: "succeed", request: 1, items: [] }, { status: "idle" }],
  [{ status: "loading", request: 1 }, { type: "succeed", request: 1, items: [] }, { status: "loaded", items: [] }],
  [{ status: "loading", request: 2 }, { type: "succeed", request: 1, items: [] }, { status: "loading", request: 2 }],
  [{ status: "loaded", items: [] }, { type: "fail", request: 1, error }, { status: "loaded", items: [] }],
] as const)("%o + %o", (state, event, next) => {
  expect(transition(state, event)).toEqual(next);
});

test("a stale request cannot finish a newer one", () => {
  const events: LoadEvent[] = [
    { type: "start", request: 1 }, { type: "reset" }, { type: "start", request: 2 },
    { type: "succeed", request: 1, items: stale },
  ];
  expect(events.reduce(transition, { status: "idle" })).toEqual({ status: "loading", request: 2 });
});
```

### More React and class shapes

- **A handler, not an effect, starts the work** (a sign-in button): take the
  request number from a `useRef` counter, dispatch `start` with it, and have
  the async handler dispatch `succeed`/`fail` with the same number.
- **Synchronous re-entrance** (two clicks before a render): keep the current
  state in a ref that one `send(event)` updates and that returns the next
  state; the caller starts work only if its own request entered `loading`.
- **A queue that spans effect runs** (read one page at a time, queue one
  refresh): keep the machine in a ref with a `useState` copy for rendering,
  written by one `send`. A superseded request that must still finish (to start
  the queued refresh) carries `current: false` instead of being dropped.
- **A handler that both changes state and decides an output** (open a menu now,
  defer it, or ignore the press): make the step a Mealy function returning
  `{ state, output }`, so every decision lives in one place.
- **Long-lived controllers that log or notify on change**: have `send` return
  the previous state too, so the caller acts only on the change that happened
  (log on `starting -> playing`, not on every event).
- **Classes holding resources** (sockets, timers, watchdogs): give each
  resource to exactly one state and release it in one `leave(previous, next)`
  step; guard `if (next === this.state) return` because leave callbacks can
  re-enter (`onDisconnect` calling `stop()`).
- **Testing async controllers**: move the React controller into its own hook
  with the async work injected, so `renderHook` can drive stale, replacement
  and Strict Mode sequences. In React Native Testing Library, start a press
  without awaiting it to observe the pending state, then resolve inside
  `await act(...)`.
- **Dismissals name what they dismiss** (outside click, escape): otherwise the
  listener of the menu that just closed can close the menu that replaced it.

### Placement and lint

- Put the reducer beside the code that runs it when a new module costs a
  network request or a build allowlist entry (bundler-free static sites), and
  in Swift in a file already compiled into the app target, to avoid an Xcode
  project edit.
- A reducer can exceed Biome's cognitive-complexity limit; one type guard such
  as `inAttempt(state, attempt, ...statuses)` usually brings it back.

## Swift

```swift
enum Upload: Equatable {
  case idle
  case uploading(progress: Double)
  case failed(message: String)
  case done(url: URL)

  func handling(_ event: UploadEvent) -> Upload {
    switch (self, event) {
    case (.idle, .start), (.failed, .start): return .uploading(progress: 0)
    case (.uploading, .progress(let p)): return .uploading(progress: p)
    case (.uploading, .finish(let url)): return .done(url: url)
    case (.uploading, .fail(let message)): return .failed(message: message)
    default: return self
    }
  }
}
```

Avoid a `default` that hides a new case where the compiler could check it:
switch on `self` first and handle every case.

## Kotlin

A `sealed interface State` with `data object Idle : State` and
`data class Failed(val error: Throwable) : State`, and a
`fun State.on(event: Event): State = when (this) { ... }` with no `else`
branch, so a new state fails to compile until it is handled.

## Python

```python
from dataclasses import dataclass
from typing import assert_never

@dataclass(frozen=True)
class Idle: ...
@dataclass(frozen=True)
class Running:
    job_id: str
@dataclass(frozen=True)
class Failed:
    error: str

State = Idle | Running | Failed

def transition(state: State, event: Event) -> State:
    match state, event:
        case Idle(), Start(job_id=job_id):
            return Running(job_id)
        case Running(), Fail(error=error):
            return Failed(error)
        case _:
            return state
```

Where a plain enum suffices (no per-state data), use `enum.Enum` and an
`ALLOWED: dict[State, frozenset[State]]` table.

## Go

A `type State int` with `const` values and a `String()` method, a
`func (s State) On(e Event) (State, error)` that returns an error for an
illegal transition, and an `exhaustive` lint if the repository runs one.

## Shell

One `state` variable and a `case "$state" in` loop instead of several
`done=0`/`failed=1` variables; print the state when the script exits early.
