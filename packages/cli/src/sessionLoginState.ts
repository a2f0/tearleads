type LoginState =
  | "not-started"
  | "challenge"
  | "renewal-challenge"
  | "verification"
  | "not-issued"
  | "authenticated"
  | "outcome-unknown";
type LoginEvent = "starting" | "dispatch-verify" | "accepted" | "unconfirmed";

function transitionLogin(state: LoginState, event: LoginEvent): LoginState {
  if (event === "starting") {
    if (state === "not-started") return "challenge";
    if (state === "authenticated") return "renewal-challenge";
  }
  const challenge = state === "challenge" || state === "renewal-challenge";
  if (challenge && event === "dispatch-verify") return "verification";
  if (!challenge && state !== "verification") return state;
  if (event === "accepted") return "authenticated";
  if (event !== "unconfirmed") return state;
  return state === "verification" ? "outcome-unknown" : "not-issued";
}

/** Only a confirmed token can revoke an issued session; a lost reply is ambiguous. */
export function commandLoginLifetime(
  revoke: () => Promise<boolean>,
  revokePrevious: () => Promise<boolean>,
) {
  let state: LoginState = "not-started";
  let settled = Promise.withResolvers<void>();
  const work = new AbortController();
  let revocation: Promise<boolean> | undefined;
  const send = (event: LoginEvent) => {
    if (state === "authenticated" && event === "starting")
      settled = Promise.withResolvers<void>();
    state = transitionLogin(state, event);
    if (
      state !== "challenge" &&
      state !== "renewal-challenge" &&
      state !== "verification"
    )
      settled.resolve();
  };
  const finish = async () => {
    const previous = state === "renewal-challenge" ? revokePrevious() : null;
    work.abort();
    if (previous) return previous;
    if (state === "verification") await settled.promise;
    if (state === "authenticated") return revoke();
    return (
      state === "not-started" || state === "challenge" || state === "not-issued"
    );
  };
  const stop = () => {
    revocation ??= finish();
    return revocation;
  };
  return {
    send,
    stop,
    observeRenewal: (renewal: Promise<boolean>) => {
      send("starting");
      void renewal.then(
        (ok) => send(ok ? "accepted" : "unconfirmed"),
        () => send("unconfirmed"),
      );
    },
    outcomeUnknown: () => state === "outcome-unknown",
    signal: work.signal,
    stopping: () => revocation !== undefined,
  };
}
