import type { Tearleads } from "@tearleads/client-sdk";

/**
 * How long an opened socket may hold its initial interest acknowledgement
 * before documents stop waiting on it. The connection loop's watchdog bounds
 * the ticket request and the handshake but stops at socket open.
 */
export const CONNECT_ACKNOWLEDGEMENT_TIMEOUT_MS = 15_000;

type ConnectAttemptEvents = Pick<
  Tearleads["events"],
  "beginConnectAttempt" | "endConnectAttempt"
>;

interface ConnectAttemptTimers {
  readonly clear: (timer: ReturnType<typeof setTimeout>) => void;
  readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMERS: ConnectAttemptTimers = {
  clear: (timer) => clearTimeout(timer),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
};

/**
 * Opened documents defer their startup probe to the acknowledgement of the
 * connect attempt in flight. The acknowledgement (`setConnected(true)`) and a
 * socket disconnect (`setConnected(false)`) settle the attempt; `end` covers
 * every other way it stops without one, and `awaitAcknowledgement` bounds the
 * wait once the declaration is sent. Ending a settled attempt is a no-op.
 */
export function trackConnectAttempts(
  events: ConnectAttemptEvents,
  timers: ConnectAttemptTimers = DEFAULT_TIMERS,
) {
  let attempt: number | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  const end = (): void => {
    if (deadline !== null) timers.clear(deadline);
    deadline = null;
    if (attempt !== null) events.endConnectAttempt(attempt);
    attempt = null;
  };
  return {
    begin: (): void => {
      end();
      attempt = events.beginConnectAttempt();
    },
    end,
    /** The declaration is sent: release the wait if no ack arrives in time. */
    awaitAcknowledgement: (): void => {
      if (attempt === null || deadline !== null) return;
      deadline = timers.schedule(end, CONNECT_ACKNOWLEDGEMENT_TIMEOUT_MS);
    },
    /** Stop the loop, then end an attempt it left pending. */
    endingWith:
      (stop: () => void): (() => void) =>
      () => {
        stop();
        end();
      },
  };
}
