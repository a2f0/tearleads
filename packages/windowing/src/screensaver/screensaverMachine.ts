export type ScreensaverState =
  | { status: "idle"; session: number }
  | { status: "grace"; session: number }
  | { status: "armed"; session: number }
  | { status: "draining"; session: number }
  | { status: "settling"; session: number };
export type ScreensaverEvent =
  | { type: "start" }
  | { type: "stop" }
  | { type: "dismiss"; escape: boolean; drain: boolean }
  | { type: "released" }
  | { type: "settled"; session: number }
  | { type: "graceElapsed"; session: number };

function dismiss(
  state: ScreensaverState,
  isEscape: boolean,
  drain: boolean,
): ScreensaverState {
  if (state.status !== "armed" && !(state.status === "grace" && isEscape))
    return state;
  return { status: drain ? "draining" : "idle", session: state.session };
}

export function transitionScreensaver(
  state: ScreensaverState,
  event: ScreensaverEvent,
): ScreensaverState {
  switch (event.type) {
    case "start":
      return state.status === "idle"
        ? { status: "grace", session: state.session + 1 }
        : state;
    case "dismiss":
      return dismiss(state, event.escape, event.drain);
    case "released":
      return state.status === "draining"
        ? { status: "settling", session: state.session }
        : state;
    case "settled":
      return state.status === "settling" && state.session === event.session
        ? { status: "idle", session: state.session }
        : state;
    case "stop":
      return state.status === "idle"
        ? state
        : { status: "idle", session: state.session };
    case "graceElapsed":
      return state.status === "grace" && state.session === event.session
        ? { status: "armed", session: state.session }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
