// The poll for system containers born with the organization (Trash), as an
// explicit state machine: one closed union of states and one pure transition.
// useProvisionedSystemContainerPull runs the effects; nothing here touches
// React or the store.
//
// One machine exists per store, organization and slot set for the provider's
// lifetime, which is one page load. Each effect run of the hook is a
// `sequence`; its cleanup cancels it back to `idle`, which keeps what the
// earlier sequences spent, including a pull still in flight. Pulls are
// sequential across sequences: the next one starts only once the last one
// settled. So however often the hook re-runs during a load, the poll for one
// organization sends at most PROVISIONED_PULL_LISTING_LIMIT root-lane
// listings, and its timer ticks at most PROVISIONED_PULL_TICK_LIMIT times. An
// organization whose tree never holds the slot (an account whose registration
// provisioned no Trash) is `abandoned` and not polled again in that load; the
// normal tree crawl still applies the slot if it appears.

/** Identity of one effect run, or of one root-lane pull. */
export type ProvisionedPullTag = object;

// Listings that reached the store's listing path. Two: a listing made before
// the registration commit was visible gets one more chance, and every later
// listing would return the same answer. A listing costs one
// `POST /containers/parent-lanes/query`.
export const PROVISIONED_PULL_LISTING_LIMIT = 2;
// Interval ticks, at PROVISIONED_PULL_INTERVAL_MS each. A tick while the store
// cannot list yet (not initialized) sends nothing but still counts, so the
// timer stops within ten seconds of polling whatever the store does.
export const PROVISIONED_PULL_TICK_LIMIT = 40;
export const PROVISIONED_PULL_INTERVAL_MS = 250;

interface ProvisionedPullBudget {
  /** Settled pulls that reached the listing path. */
  readonly listings: number;
  /** The pull in flight, whichever sequence started it. */
  readonly pull: ProvisionedPullTag | null;
  readonly ticks: number;
}

export type ProvisionedPullState =
  /** No sequence is running. Holds what earlier sequences spent. */
  | ({ readonly status: "idle" } & ProvisionedPullBudget)
  /** Re-reading local SQLite before deciding whether to poll. */
  | ({
      readonly status: "surfacing";
      readonly sequence: ProvisionedPullTag;
    } & ProvisionedPullBudget)
  /** The timer runs. */
  | ({
      readonly status: "polling";
      readonly sequence: ProvisionedPullTag;
    } & ProvisionedPullBudget)
  /** Every provisioned slot is in the tree. */
  | { readonly status: "settled" }
  /** The budget ran out with these slots still missing. */
  | {
      readonly status: "abandoned";
      readonly listings: number;
      readonly missingSlots: ReadonlyArray<string>;
    };

export type ProvisionedPullEvent =
  /** An effect run found a provisioned slot missing. */
  | { readonly type: "start"; readonly sequence: ProvisionedPullTag }
  /** The effect run was cleaned up. */
  | { readonly type: "cancel"; readonly sequence: ProvisionedPullTag }
  /** The local re-read finished; these slots are still missing. */
  | {
      readonly type: "surfaced";
      readonly missingSlots: ReadonlyArray<string>;
      readonly sequence: ProvisionedPullTag;
    }
  /**
   * The timer fired (or polling began). `pull` is the tag a pull started on
   * this tick would carry.
   */
  | {
      readonly type: "tick";
      readonly missingSlots: ReadonlyArray<string>;
      readonly pull: ProvisionedPullTag;
      readonly sequence: ProvisionedPullTag;
    }
  /**
   * A pull finished. `listed` is false when the store could not list at all
   * (it returned false without a request); a rejected pull did reach it.
   */
  | {
      readonly type: "pull-settled";
      readonly listed: boolean;
      readonly pull: ProvisionedPullTag;
    };

export const INITIAL_PROVISIONED_PULL_STATE: ProvisionedPullState = {
  listings: 0,
  pull: null,
  status: "idle",
  ticks: 0,
};

function budgetSpent(budget: ProvisionedPullBudget): boolean {
  return (
    budget.listings >= PROVISIONED_PULL_LISTING_LIMIT ||
    budget.ticks >= PROVISIONED_PULL_TICK_LIMIT
  );
}

function budgetOf(state: ProvisionedPullBudget): ProvisionedPullBudget {
  return { listings: state.listings, pull: state.pull, ticks: state.ticks };
}

function abandon(
  listings: number,
  missingSlots: ReadonlyArray<string>,
): ProvisionedPullState {
  return { listings, missingSlots, status: "abandoned" };
}

function start(
  state: ProvisionedPullState,
  sequence: ProvisionedPullTag,
): ProvisionedPullState {
  switch (state.status) {
    case "abandoned":
      return state;
    // A slot that was present went missing again: a new situation, a new budget.
    case "settled":
      return {
        listings: 0,
        pull: null,
        sequence,
        status: "surfacing",
        ticks: 0,
      };
    case "idle":
    case "surfacing":
    case "polling":
      return { ...budgetOf(state), sequence, status: "surfacing" };
    default:
      return assertNever(state);
  }
}

function surface(
  state: ProvisionedPullState,
  event: Extract<ProvisionedPullEvent, { type: "surfaced" }>,
): ProvisionedPullState {
  if (state.status !== "surfacing" || state.sequence !== event.sequence) {
    return state;
  }
  if (event.missingSlots.length === 0) return { status: "settled" };
  if (budgetSpent(state)) return abandon(state.listings, event.missingSlots);
  return { ...budgetOf(state), sequence: state.sequence, status: "polling" };
}

function tick(
  state: ProvisionedPullState,
  event: Extract<ProvisionedPullEvent, { type: "tick" }>,
): ProvisionedPullState {
  if (state.status !== "polling" || state.sequence !== event.sequence) {
    return state;
  }
  if (event.missingSlots.length === 0) return { status: "settled" };
  if (budgetSpent(state)) return abandon(state.listings, event.missingSlots);
  // Pulls stay sequential: a tick while one is in flight only counts.
  return {
    ...state,
    pull: state.pull ?? event.pull,
    ticks: state.ticks + 1,
  };
}

function settlePull(
  state: ProvisionedPullState,
  event: Extract<ProvisionedPullEvent, { type: "pull-settled" }>,
): ProvisionedPullState {
  if (
    state.status === "settled" ||
    state.status === "abandoned" ||
    state.pull !== event.pull
  ) {
    // Not the pull in flight: one from before the budget restarted.
    return state;
  }
  return {
    ...state,
    listings: state.listings + (event.listed ? 1 : 0),
    pull: null,
  };
}

/**
 * Pure transition. Returns the same reference when an event changes nothing,
 * so the hook can tell a pull was started by comparing the `pull` tags.
 */
export function transitionProvisionedPull(
  state: ProvisionedPullState,
  event: ProvisionedPullEvent,
): ProvisionedPullState {
  switch (event.type) {
    case "start":
      return start(state, event.sequence);
    case "cancel":
      return (state.status === "surfacing" || state.status === "polling") &&
        state.sequence === event.sequence
        ? { ...budgetOf(state), status: "idle" }
        : state;
    case "surfaced":
      return surface(state, event);
    case "tick":
      return tick(state, event);
    case "pull-settled":
      return settlePull(state, event);
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled provisioned pull value: ${JSON.stringify(value)}`);
}
