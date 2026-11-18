type AuthenticationState =
  | { readonly status: "idle" }
  | { readonly status: "login" | "renewal"; readonly attempt: symbol };

type AuthenticationEvent =
  | {
      readonly type: "login" | "renewal" | "finished";
      readonly attempt: symbol;
    }
  | { readonly type: "invalidated" };

export function transitionAuthentication(
  state: AuthenticationState,
  event: AuthenticationEvent,
): AuthenticationState {
  switch (event.type) {
    case "login":
      return { status: "login", attempt: event.attempt };
    case "renewal":
      return state.status === "idle"
        ? { status: "renewal", attempt: event.attempt }
        : state;
    case "finished":
      return state.status !== "idle" && state.attempt === event.attempt
        ? { status: "idle" }
        : state;
    case "invalidated":
      return { status: "idle" };
  }
}

export class SessionAuthentication {
  private state: AuthenticationState = { status: "idle" };

  private lastLogin: symbol | undefined;

  captureRestore(): () => boolean {
    const login = this.lastLogin;
    const allowed = this.state.status !== "login";
    return () => allowed && login === this.lastLogin;
  }

  start(renewal: boolean) {
    const attempt = Symbol();
    if (!renewal) this.lastLogin = attempt;
    this.state = transitionAuthentication(this.state, {
      type: renewal ? "renewal" : "login",
      attempt,
    });
    return {
      current: () =>
        this.state.status !== "idle" && this.state.attempt === attempt,
      finish: () => {
        this.state = transitionAuthentication(this.state, {
          type: "finished",
          attempt,
        });
      },
    };
  }

  invalidate(): void {
    this.state = transitionAuthentication(this.state, { type: "invalidated" });
  }
}
