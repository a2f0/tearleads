type ResourceIdentity = { request: object; identity?: object | undefined };
export type ContainerViewResource<T> = ResourceIdentity &
  (
    | { status: "loading" }
    | { status: "ready" | "refreshing"; value: T }
    | { status: "failed"; error: string }
  );
export type ContainerViewResourceEvent<T> =
  | ({ type: "start" } & ResourceIdentity)
  | { type: "loaded"; request: object; value: T }
  | { type: "failed"; request: object; error: string };

export function transitionContainerViewResource<T>(
  state: ContainerViewResource<T>,
  event: ContainerViewResourceEvent<T>,
): ContainerViewResource<T> {
  if (event.type === "start") {
    const identity = event.identity ? { identity: event.identity } : {};
    if (
      event.identity &&
      state.identity === event.identity &&
      (state.status === "ready" || state.status === "refreshing")
    ) {
      return {
        status: "refreshing",
        request: event.request,
        ...identity,
        value: state.value,
      };
    }
    return { status: "loading", request: event.request, ...identity };
  }
  if (
    (state.status !== "loading" && state.status !== "refreshing") ||
    state.request !== event.request
  )
    return state;
  const identity = state.identity ? { identity: state.identity } : {};
  switch (event.type) {
    case "loaded":
      return {
        status: "ready",
        request: event.request,
        ...identity,
        value: event.value,
      };
    case "failed":
      return {
        status: "failed",
        request: event.request,
        ...identity,
        error: event.error,
      };
  }
}
