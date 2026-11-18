// A manual request can lend its watermark reset to the crawl that consumes
// the shared lane queue. Socket acknowledgements change the crawl, while
// identity, storage and write ownership determine who can inherit the reset.
interface Owner {
  lifecycleGeneration: number;
  writeGeneration?: number;
}
type Reset = { status: "queued" | "incomplete"; owner: Owner };
type State = Reset | { status: "idle" };
type Event =
  | { type: "requested"; owner: Owner }
  | { type: "start"; owner: Owner; fullTree: boolean }
  | { type: "covered"; reset: Reset };

function sameOwner(left: Owner, right: Owner): boolean {
  return (
    left.lifecycleGeneration === right.lifecycleGeneration &&
    left.writeGeneration === right.writeGeneration
  );
}

function transition(state: State, event: Event): State {
  switch (event.type) {
    case "requested":
      return { status: "queued", owner: event.owner };
    case "start":
      if (state.status === "idle") return state;
      if (!sameOwner(state.owner, event.owner)) return { status: "idle" };
      if (state.status === "incomplete" && !event.fullTree) return state;
      return { status: "incomplete", owner: state.owner };
    case "covered":
      return state === event.reset ? { status: "idle" } : state;
  }
}

const resets = new WeakMap<Owner, State>();

function dispatch(store: Owner, event: Event): State {
  const next = transition(resets.get(store) ?? { status: "idle" }, event);
  if (next.status === "idle") resets.delete(store);
  else resets.set(store, next);
  return next;
}

function captureOwner(store: Owner): Owner {
  return {
    lifecycleGeneration: store.lifecycleGeneration,
    ...(store.writeGeneration !== undefined
      ? { writeGeneration: store.writeGeneration }
      : {}),
  };
}

export function queueTreeReset(store: Owner): () => boolean {
  const owner = captureOwner(store);
  dispatch(store, { type: "requested", owner });
  return () => sameOwner(owner, store);
}

export function claimTreeReset(
  store: Owner,
  fullTree: boolean,
): { isOwned: () => boolean; cover: () => void } | undefined {
  const previous = resets.get(store);
  if (!previous) return;
  const reset = dispatch(store, { type: "start", owner: store, fullTree });
  if (reset.status !== "incomplete" || reset === previous) return;
  return {
    isOwned: () => sameOwner(reset.owner, store),
    cover: () => {
      dispatch(store, { type: "covered", reset });
    },
  };
}
