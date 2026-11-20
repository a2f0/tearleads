type LoginState =
  | "not-started"
  | "challenge"
  | "verification"
  | "not-issued"
  | "authenticated"
  | "outcome-unknown";
type LoginEvent = "starting" | "dispatch-verify" | "accepted" | "unconfirmed";

function transitionLogin(state: LoginState, event: LoginEvent): LoginState {
  if (state === "not-started" && event === "starting") return "challenge";
  if (state === "challenge" && event === "dispatch-verify")
    return "verification";
  if (state !== "challenge" && state !== "verification") return state;
  if (event === "accepted") return "authenticated";
  if (event !== "unconfirmed") return state;
  return state === "verification" ? "outcome-unknown" : "not-issued";
}

/** Only a confirmed token can revoke an issued session; a lost reply is ambiguous. */
export function commandLoginLifetime(revoke: () => Promise<boolean>) {
  let state: LoginState = "not-started";
  const settled = Promise.withResolvers<void>();
  const work = new AbortController();
  const logout = Promise.withResolvers<void>();
  let revocation: Promise<boolean> | undefined;
  const send = (event: LoginEvent) => {
    state = transitionLogin(state, event);
    if (state !== "challenge" && state !== "verification") settled.resolve();
  };
  const stop = () => {
    if (!revocation) {
      const finish = async () => {
        work.abort();
        if (state === "verification") await settled.promise;
        if (state === "authenticated") {
          logout.resolve();
          return revoke();
        }
        return (
          state === "not-started" ||
          state === "challenge" ||
          state === "not-issued"
        );
      };
      revocation = finish();
    }
    return revocation;
  };
  return {
    send,
    stop,
    logoutStarted: logout.promise,
    outcomeUnknown: () => state === "outcome-unknown",
    signal: work.signal,
    stopping: () => revocation !== undefined,
  };
}
