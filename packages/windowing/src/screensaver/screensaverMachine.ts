type Session = { session: number; locked?: true };
export type ScreensaverState =
  | { status: "idle"; session: number; locked?: never }
  | (Session & {
      status: "grace" | "armed" | "draining" | "settling";
    })
  | {
      status: "resuming" | "resumeSettling";
      session: number;
      locked: true;
    }
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
  | { type: "cancel"; drain: boolean }
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

function cancel(state: ScreensaverState, drain: boolean): ScreensaverState {
  return state.status === "unlock" || state.status === "verifying"
    ? {
        status: drain ? "resuming" : "resumeSettling",
        session: state.session + 1,
        locked: true,
      }
    : state;
}

function released(state: ScreensaverState): ScreensaverState {
  if (state.status === "resuming")
    return { ...state, status: "resumeSettling" };
  return state.status === "draining" ? { ...state, status: "settling" } : state;
}

function settled(state: ScreensaverState, session: number): ScreensaverState {
  if (state.session !== session) return state;
  if (state.status === "resumeSettling") return { ...state, status: "grace" };
  return state.status === "settling" ? finish(state) : state;
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
      return released(state);
    case "settled":
      return settled(state, event.session);
    case "stop":
      return stop(state);
    case "cancel":
      return cancel(state, event.drain);
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
