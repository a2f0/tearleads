import { useCallback, useEffect, useRef, useState } from "react";
import { captureScreensaverInput } from "./screensaverInput";
import {
  type ScreensaverEvent,
  type ScreensaverState,
  transitionScreensaver,
} from "./screensaverMachine";
import { useScreensaverIsolation } from "./useScreensaverIsolation";

export function useScreensaverController(gracePeriodMs: number) {
  const [state, setState] = useState<ScreensaverState>({
    status: "idle",
    session: 0,
  });
  const live = useRef(state);
  const send = useCallback((event: ScreensaverEvent) => {
    const next = transitionScreensaver(live.current, event);
    live.current = next;
    setState(next);
  }, []);
  const rememberFocus = useScreensaverIsolation(state.status !== "idle");
  const start = useCallback(() => {
    if (live.current.status === "idle") rememberFocus();
    send({ type: "start" });
  }, [send, rememberFocus]);
  const stop = useCallback(() => send({ type: "stop" }), [send]);
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
  useEffect(() => {
    return captureScreensaverInput(() => live.current, send);
  }, [send]);
  return {
    isActive: state.status === "grace" || state.status === "armed",
    session: state.session,
    start,
    stop,
  };
}
