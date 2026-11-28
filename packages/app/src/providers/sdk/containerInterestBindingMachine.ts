import type { DomainScope } from "@tearleads/client-sdk";

/**
 * Lifecycle of one WebSocket's container-interest binding to a Tearleads
 * `DomainScope`.
 *
 * - `awaiting-tree`: bound to `scope`, but the local tree has not yet emitted a
 *   ready snapshot, so no `known_containers` frame has been sent on the socket.
 *   If SQLite or identity finishes booting and rotates `domainScope`, the open
 *   socket can rebind in place to the replacement scope without losing the
 *   connection or leaking the pre-ready scope.
 * - `declared`: at least one `known_containers` frame has been sent for `scope`.
 *   Any later scope retirement must close the socket so the reconnect loop
 *   establishes a fresh server-side ordering barrier.
 * - `unavailable`: opening `deviceFirst.open().containerStore` failed.
 * - `stopped`: explicitly stopped or closed after scope retirement.
 */
export type ContainerInterestBindingState =
  | { readonly status: "awaiting-tree"; readonly scope: DomainScope }
  | { readonly status: "declared"; readonly scope: DomainScope }
  | { readonly status: "unavailable" }
  | { readonly status: "stopped" };

export type ContainerInterestBindingEvent =
  | { readonly type: "declaration-sent" }
  | { readonly type: "bind-failed" }
  | {
      readonly type: "scope-retired";
      readonly nextScope: DomainScope;
      readonly canRebind: boolean;
      readonly socketOpen: boolean;
    }
  | { readonly type: "stop" };

export type ContainerInterestBindingEffect =
  | "none"
  | "rebind"
  | "close-socket"
  | "mark-unavailable";

export interface ContainerInterestBindingTransition {
  readonly state: ContainerInterestBindingState;
  readonly effect: ContainerInterestBindingEffect;
}

function transitionAwaitingTree(
  state: Extract<ContainerInterestBindingState, { status: "awaiting-tree" }>,
  event: Exclude<ContainerInterestBindingEvent, { type: "stop" }>,
): ContainerInterestBindingTransition {
  switch (event.type) {
    case "declaration-sent":
      return {
        state: { status: "declared", scope: state.scope },
        effect: "none",
      };
    case "bind-failed":
      return {
        state: { status: "unavailable" },
        effect: "mark-unavailable",
      };
    case "scope-retired":
      if (
        event.nextScope !== state.scope &&
        event.canRebind &&
        event.socketOpen
      ) {
        return {
          state: { status: "awaiting-tree", scope: event.nextScope },
          effect: "rebind",
        };
      }
      return { state: { status: "stopped" }, effect: "close-socket" };
  }
}

export function transitionContainerInterestBinding(
  state: ContainerInterestBindingState,
  event: ContainerInterestBindingEvent,
): ContainerInterestBindingTransition {
  if (event.type === "stop") {
    return { state: { status: "stopped" }, effect: "none" };
  }
  switch (state.status) {
    case "stopped":
    case "unavailable":
      return { state, effect: "none" };
    case "awaiting-tree":
      return transitionAwaitingTree(state, event);
    case "declared":
      if (event.type === "scope-retired") {
        return { state: { status: "stopped" }, effect: "close-socket" };
      }
      return { state, effect: "none" };
  }
}
