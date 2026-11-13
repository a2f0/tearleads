import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { captureScreensaverInput } from "./screensaverInput";
import type { ScreensaverLock } from "./screensaverLock";
import {
  type ScreensaverEvent,
  type ScreensaverState,
  transitionScreensaver,
} from "./screensaverMachine";
import { useScreensaverIsolation } from "./useScreensaverIsolation";

export function useScreensaverController(
  gracePeriodMs: number,
  lock?: ScreensaverLock,
) {
  const [state, setState] = useState<ScreensaverState>({
    status: "idle",
    session: 0,
  });
  const live = useRef(state);
  const held = useRef(new Set<string>());
  const configuration = useRef(lock);
  const sessionLock = useRef<ScreensaverLock | undefined>(undefined);
  useLayoutEffect(() => {
    configuration.current = lock;
  }, [lock]);
  const engaged = state.status !== "idle";
  const send = useCallback((event: ScreensaverEvent) => {
    const next = transitionScreensaver(live.current, event);
    live.current = next;
    setState(next);
  }, []);
  const rememberFocus = useScreensaverIsolation(state.status !== "idle");
  const start = useCallback(() => {
    if (live.current.status !== "idle") return;
    rememberFocus();
    const configured = configuration.current;
    sessionLock.current = configured
      ? { lock: configured.lock, unlock: configured.unlock }
      : undefined;
    send({ type: "start", ...(configured ? { locked: true } : {}) });
    sessionLock.current?.lock();
  }, [send, rememberFocus]);
  const stop = useCallback(() => send({ type: "stop" }), [send]);
  const submit = useCallback(
    (pin: string) => send({ type: "submit", pin }),
    [send],
  );
  useEffect(() => {
    if (state.status !== "verifying") return;
    let cancelled = false;
    const verify = async () => {
      let error: string | null = "PIN code is incorrect.";
      try {
        if (await sessionLock.current?.unlock(state.pin)) error = null;
      } catch {
        error = "Unable to unlock. Try again.";
      }
      if (!cancelled)
        send({
          type: "verified",
          session: state.session,
          attempt: state.attempt,
          error,
          drain: held.current.size > 0,
        });
    };
    void verify();
    return () => {
      cancelled = true;
    };
  }, [state, send]);
  useEffect(() => {
    if (state.status !== "grace" && state.status !== "settling") return;
    const timer = setTimeout(
      () =>
        send({
          type: state.status === "grace" ? "graceElapsed" : "settled",
          session: state.session,
        }),
      state.status === "grace" ? gracePeriodMs : 0,
    );
    return () => clearTimeout(timer);
  }, [state, gracePeriodMs, send]);
  useLayoutEffect(() => {
    if (!engaged) held.current.clear();
    return captureScreensaverInput(
      () => live.current,
      send,
      held.current,
      engaged,
    );
  }, [engaged, send]);
  return {
    isActive:
      state.status === "grace" ||
      state.status === "armed" ||
      state.locked === true,
    state,
    submit,
    start,
    stop,
  };
}
