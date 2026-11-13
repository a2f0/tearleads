import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { captureScreensaverInput } from "./screensaverInput";
import {
  type ScreensaverEvent,
  type ScreensaverState,
  transitionScreensaver,
} from "./screensaverMachine";
import type { ScreensaverPinVerifier } from "./screensaverPinVerifier";
import { useScreensaverIsolation } from "./useScreensaverIsolation";

export function useScreensaverController(
  gracePeriodMs: number,
  verifyPin?: ScreensaverPinVerifier,
) {
  const [state, setState] = useState<ScreensaverState>({
    status: "idle",
    session: 0,
  });
  const live = useRef(state);
  const held = useRef(new Set<string>());
  const configuration = useRef(verifyPin);
  const sessionVerifier = useRef<ScreensaverPinVerifier | undefined>(undefined);
  useLayoutEffect(() => {
    configuration.current = verifyPin;
  }, [verifyPin]);
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
    sessionVerifier.current = configured;
    send({ type: "start", ...(configured ? { locked: true } : {}) });
  }, [send, rememberFocus]);
  const stop = useCallback(() => send({ type: "stop" }), [send]);
  const cancel = useCallback(
    () => send({ type: "cancel", drain: held.current.size > 0 }),
    [send],
  );
  const dismiss = useCallback(() => {
    const { status } = live.current;
    if (status === "unlock" || status === "verifying") cancel();
    else stop();
  }, [cancel, stop]);
  const submit = useCallback(
    (pin: string) => send({ type: "submit", pin }),
    [send],
  );
  useEffect(() => {
    if (state.status !== "verifying") return;
    const controller = new AbortController();
    const verify = async () => {
      let error: string | null = "PIN code is incorrect.";
      try {
        if (await sessionVerifier.current?.(state.pin, controller.signal))
          error = null;
      } catch {
        error = "Unable to unlock. Try again.";
      }
      if (!controller.signal.aborted)
        send({
          type: "verified",
          session: state.session,
          attempt: state.attempt,
          error,
          drain: held.current.size > 0,
        });
    };
    void verify();
    return () => controller.abort();
  }, [state, send]);
  useScreensaverTimer(state, gracePeriodMs, send);
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
    cancel,
    dismiss,
    start,
    stop,
  };
}

function useScreensaverTimer(
  state: ScreensaverState,
  gracePeriodMs: number,
  send: (event: ScreensaverEvent) => void,
) {
  useEffect(() => {
    if (!["grace", "settling", "resumeSettling"].includes(state.status)) return;
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
}
