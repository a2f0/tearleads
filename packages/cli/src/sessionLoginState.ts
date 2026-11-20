type LoginState =
  | "not-started"
  | "in-flight"
  | "authenticated"
  | "outcome-unknown";
type LoginEvent = "starting" | "accepted" | "unconfirmed";

function transitionLogin(state: LoginState, event: LoginEvent): LoginState {
  if (state === "not-started" && event === "starting") return "in-flight";
  if (state !== "in-flight") return state;
  if (event === "accepted") return "authenticated";
  return event === "unconfirmed" ? "outcome-unknown" : state;
}

/** Only a confirmed token can revoke an issued session; a lost reply is ambiguous. */
export function commandLoginLifetime(revoke: () => Promise<boolean>) {
  let state: LoginState = "not-started";
  const settled = Promise.withResolvers<void>();
  const work = new AbortController();
  let revocation: Promise<boolean> | undefined;
  const send = (event: LoginEvent) => {
    state = transitionLogin(state, event);
    if (state !== "in-flight") settled.resolve();
  };
  const stop = () => {
    if (!revocation) {
      const finish = async () => {
        if (state === "in-flight") await settled.promise;
        work.abort();
        if (state === "authenticated") return revoke();
        return state === "not-started";
      };
      revocation = finish();
    }
    return revocation;
  };
  return {
    send,
    stop,
    signal: work.signal,
    stopping: () => revocation !== undefined,
  };
}
