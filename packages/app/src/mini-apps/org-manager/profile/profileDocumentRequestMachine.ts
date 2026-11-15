export type ProfileDocumentRequestState<T> =
  | { readonly status: "loading"; readonly request: object }
  | { readonly status: "ready"; readonly request: object; readonly value: T }
  | { readonly status: "unavailable"; readonly request: object };

export type ProfileDocumentRequestEvent<T> =
  | { readonly type: "started"; readonly request: object }
  | { readonly type: "resolved"; readonly request: object; readonly value: T }
  | { readonly type: "unavailable"; readonly request: object };

export function transitionProfileDocumentRequest<T>(
  state: ProfileDocumentRequestState<T>,
  event: ProfileDocumentRequestEvent<T>,
): ProfileDocumentRequestState<T> {
  switch (event.type) {
    case "started":
      return { status: "loading", request: event.request };
    case "resolved":
      return state.status === "loading" && state.request === event.request
        ? { status: "ready", request: event.request, value: event.value }
        : state;
    case "unavailable":
      return state.status === "loading" && state.request === event.request
        ? { status: "unavailable", request: event.request }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
