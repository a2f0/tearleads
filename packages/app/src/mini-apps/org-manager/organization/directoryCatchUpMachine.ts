/**
 * The roster's read-model catch-up for one subscription key (the Org Manager
 * scope while it can subscribe). Stamping awaiting and settled with their key
 * makes a new organization, scope, or reconnect await its own catch-up, and
 * keeps a superseded subscription's settlement from ending the current wait.
 *
 * | state       | demand(null) | demand(k)            | settle(k)            |
 * | ----------- | ------------ | -------------------- | -------------------- |
 * | inactive    | -            | awaiting k           | -                    |
 * | awaiting k' | inactive     | awaiting k if k ≠ k' | settled k if k = k'  |
 * | settled k'  | inactive     | awaiting k if k ≠ k' | -                    |
 *
 * `-` returns the same state.
 */
export type DirectoryCatchUpState =
  | { readonly status: "inactive" }
  | { readonly status: "awaiting"; readonly key: string }
  | { readonly status: "settled"; readonly key: string };

export type DirectoryCatchUpEvent =
  /** The key the roster can subscribe under, or null when it cannot. */
  | { readonly type: "demand"; readonly key: string | null }
  /** The subscription made under `key` reported its catch-up settled. */
  | { readonly type: "settle"; readonly key: string };

const INACTIVE_DIRECTORY_CATCH_UP: DirectoryCatchUpState = {
  status: "inactive",
};

export function initialDirectoryCatchUp(
  key: string | null,
): DirectoryCatchUpState {
  return key === null
    ? INACTIVE_DIRECTORY_CATCH_UP
    : { key, status: "awaiting" };
}

export function transitionDirectoryCatchUp(
  state: DirectoryCatchUpState,
  event: DirectoryCatchUpEvent,
): DirectoryCatchUpState {
  switch (event.type) {
    case "demand":
      if (event.key === null) {
        return state.status === "inactive"
          ? state
          : INACTIVE_DIRECTORY_CATCH_UP;
      }
      return state.status !== "inactive" && state.key === event.key
        ? state
        : { key: event.key, status: "awaiting" };
    case "settle":
      return state.status === "awaiting" && state.key === event.key
        ? { key: event.key, status: "settled" }
        : state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled roster catch-up event: ${JSON.stringify(value)}`);
}
