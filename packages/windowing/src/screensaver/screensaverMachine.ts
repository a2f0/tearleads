type Session = { session: number; locked?: true };
export type ScreensaverState =
  | { status: "idle"; session: number; locked?: never }
  | (Session & { status: "grace" | "armed" | "draining" | "settling" })
  | {
      status: "unlock";
      session: number;
      locked: true;
      attempt: number;
      error: string | null;
    }
  | {
      status: "verifying";
      session: number;
      locked: true;
      attempt: number;
      pin: string;
    };
export type ScreensaverEvent =
  | { type: "start"; locked?: true }
  | { type: "stop" }
  | { type: "dismiss"; escape: boolean; drain: boolean }
  | { type: "released" }
  | { type: "settled"; session: number }
  | { type: "graceElapsed"; session: number }
  | { type: "submit"; pin: string }
  | {
      type: "verified";
      session: number;
      attempt: number;
      error: string | null;
      drain: boolean;
    };

function finish(state: Session): ScreensaverState {
  return state.locked
    ? {
        status: "unlock",
        session: state.session,
        locked: true,
        attempt: 0,
        error: null,
      }
    : { status: "idle", session: state.session };
}

function dismiss(
  state: ScreensaverState,
  isEscape: boolean,
  drain: boolean,
): ScreensaverState {
  if (state.status !== "armed" && !(state.status === "grace" && isEscape))
    return state;
  return drain ? { ...state, status: "draining" } : finish(state);
}

function stop(state: ScreensaverState): ScreensaverState {
  if (state.status === "idle") return state;
  if (state.locked) {
    return state.status === "grace" || state.status === "armed"
      ? finish(state)
      : state;
  }
  return { status: "idle", session: state.session };
}

function submit(state: ScreensaverState, pin: string): ScreensaverState {
  return state.status === "unlock" && pin
    ? {
        status: "verifying",
        session: state.session,
        locked: true,
        attempt: state.attempt + 1,
        pin,
      }
    : state;
}

function verified(
  state: ScreensaverState,
  event: Extract<ScreensaverEvent, { type: "verified" }>,
): ScreensaverState {
  if (
    state.status !== "verifying" ||
    state.session !== event.session ||
    state.attempt !== event.attempt
  )
    return state;
  return event.error
    ? {
        status: "unlock",
        session: state.session,
        locked: true,
        attempt: state.attempt,
        error: event.error,
      }
    : { status: event.drain ? "draining" : "settling", session: state.session };
}

export function transitionScreensaver(
  state: ScreensaverState,
  event: ScreensaverEvent,
): ScreensaverState {
  switch (event.type) {
    case "start":
      return state.status === "idle"
        ? {
            status: "grace",
            session: state.session + 1,
            ...(event.locked ? { locked: true } : {}),
          }
        : state;
    case "dismiss":
      return dismiss(state, event.escape, event.drain);
    case "released":
      return state.status === "draining"
        ? { ...state, status: "settling" }
        : state;
    case "settled":
      return state.status === "settling" && state.session === event.session
        ? finish(state)
        : state;
    case "stop":
      return stop(state);
    case "graceElapsed":
      return state.status === "grace" && state.session === event.session
        ? { ...state, status: "armed" }
        : state;
    case "submit":
      return submit(state, event.pin);
    case "verified":
      return verified(state, event);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
