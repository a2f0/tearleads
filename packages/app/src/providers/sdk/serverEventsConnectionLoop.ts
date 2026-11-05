import {
  connectionSocket,
  SERVER_EVENTS_IDLE,
  type ServerEventsConnectionEvent,
  type ServerEventsConnectionState,
  transitionServerEventsConnection,
} from "./serverEventsConnectionState";

interface ServerEventsConnectionLoopInput {
  /** A connect attempt starts (before its ticket request). */
  readonly onAttemptStart?: (() => void) | undefined;
  /** The attempt ended before a socket was bound (no ticket, no socket). */
  readonly onAttemptFailed?: (() => void) | undefined;
  readonly onDisconnect: () => void;
  readonly onMessage: (ws: WebSocket, event: MessageEvent) => void;
  readonly onOpen: (ws: WebSocket) => void;
  /** Opens the API socket for a ticket; the SDK's API client owns the URL. */
  readonly openSocket: (ticket: string) => WebSocket;
  readonly requestTicket: () => Promise<string | null>;
}

type TimerHandle = number | ReturnType<typeof setTimeout>;

interface ServerEventsConnectionLoopDeps {
  readonly clearTimer?: ((timer: TimerHandle) => void) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => number) | undefined;
  readonly scheduleTimer?:
    | ((callback: () => void, delayMs: number) => TimerHandle)
    | undefined;
  readonly clearWatchdog?: ((timer: TimerHandle) => void) | undefined;
  readonly scheduleWatchdog?:
    | ((callback: () => void, delayMs: number) => TimerHandle)
    | undefined;
}

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STABLE_CONNECTION_MS = 10_000;
const CONNECTION_WATCHDOG_MS = 15_000;

class ServerEventsConnectionLoop {
  private state: ServerEventsConnectionState = SERVER_EVENTS_IDLE;
  /** Backoff exponent; reset once a connection stays up long enough. */
  private reconnectAttempt = 0;
  // Resources owned by one state each, released when the loop leaves it.
  private cancelTicketRequest: (() => void) | null = null; // requesting-ticket
  private socketWatchdog: TimerHandle | null = null; // opening
  private reconnectTimer: TimerHandle | null = null; // backoff

  constructor(
    private readonly input: ServerEventsConnectionLoopInput,
    private readonly clearTimer: (timer: TimerHandle) => void,
    private readonly clearWatchdog: (timer: TimerHandle) => void,
    private readonly now: () => number,
    private readonly random: () => number,
    private readonly scheduleTimer: (
      callback: () => void,
      delayMs: number,
    ) => TimerHandle,
    private readonly scheduleWatchdog: (
      callback: () => void,
      delayMs: number,
    ) => TimerHandle,
  ) {}

  start(): void {
    this.send({ type: "start" });
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  private send(event: ServerEventsConnectionEvent): void {
    const previous = this.state;
    const next = transitionServerEventsConnection(previous, event);
    if (next === previous) {
      return;
    }
    this.state = next;
    this.leave(previous, next);
    // A callback run while leaving (onDisconnect, onAttemptFailed) may have
    // moved the loop on already, e.g. by stopping it; enter only the current
    // state.
    if (this.state === next) {
      this.enter(next);
    }
  }

  private leave(
    previous: ServerEventsConnectionState,
    next: ServerEventsConnectionState,
  ): void {
    switch (previous.status) {
      case "requesting-ticket": {
        const cancel = this.cancelTicketRequest;
        this.cancelTicketRequest = null;
        cancel?.();
        if (next.status === "backoff") {
          this.input.onAttemptFailed?.();
        }
        return;
      }
      case "opening":
        this.clearSocketWatchdog();
        if (next.status !== "open") {
          this.releaseSocket(previous, next);
        }
        return;
      case "open":
        this.releaseSocket(previous, next);
        return;
      case "backoff":
        if (this.reconnectTimer !== null) {
          this.clearTimer(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        return;
      case "idle":
      case "stopped":
        return;
      default:
        assertNever(previous);
    }
  }

  private enter(state: ServerEventsConnectionState): void {
    switch (state.status) {
      case "requesting-ticket":
        this.input.onAttemptStart?.();
        void this.requestAttemptTicket(state.attempt);
        return;
      case "opening":
        this.bindSocket(state.attempt, state.socket);
        return;
      case "open":
        this.input.onOpen(state.socket);
        return;
      case "backoff":
        this.scheduleReconnect(state.attempt);
        return;
      case "idle":
      case "stopped":
        return;
      default:
        assertNever(state);
    }
  }

  private releaseSocket(
    previous: Extract<
      ServerEventsConnectionState,
      { status: "opening" | "open" }
    >,
    next: ServerEventsConnectionState,
  ): void {
    if (next.status === "stopped") {
      try {
        previous.socket.close();
      } catch {
        // Cleanup must still settle the logical connection.
      }
    }
    if (
      previous.status === "open" &&
      this.now() - previous.openedAtMs >= STABLE_CONNECTION_MS
    ) {
      this.reconnectAttempt = 0;
    }
    this.input.onDisconnect();
  }

  private async requestAttemptTicket(attempt: number): Promise<void> {
    const ticket = await this.requestTicket();
    if (
      this.state.status !== "requesting-ticket" ||
      this.state.attempt !== attempt
    ) {
      return;
    }
    if (ticket === null) {
      this.send({ attempt, type: "attempt-failed" });
      return;
    }

    let socket: WebSocket;
    try {
      socket = this.input.openSocket(ticket);
    } catch {
      this.send({ attempt, type: "attempt-failed" });
      return;
    }
    this.send({ attempt, socket, type: "socket-bound" });
  }

  private async requestTicket(): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      let watchdog: TimerHandle | null = null;
      const finish = (ticket: string | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (watchdog) {
          this.clearWatchdog(watchdog);
        }
        if (this.cancelTicketRequest === cancel) {
          this.cancelTicketRequest = null;
        }
        resolve(ticket);
      };
      const cancel = () => finish(null);
      this.cancelTicketRequest = cancel;
      watchdog = this.scheduleWatchdog(cancel, CONNECTION_WATCHDOG_MS);
      void this.input.requestTicket().then(finish, cancel);
    });
  }

  private bindSocket(attempt: number, ws: WebSocket): void {
    const closed = (): void => this.send({ attempt, type: "socket-closed" });
    const closeAndSettle = (): void => {
      try {
        ws.close();
      } finally {
        closed();
      }
    };
    this.socketWatchdog = this.scheduleWatchdog(
      closeAndSettle,
      CONNECTION_WATCHDOG_MS,
    );

    ws.addEventListener("open", () => {
      this.send({ atMs: this.now(), attempt, type: "socket-opened" });
    });
    ws.addEventListener("message", (event) => {
      if (connectionSocket(this.state) === ws) {
        this.input.onMessage(ws, event);
      }
    });
    ws.addEventListener("close", closed);
    ws.addEventListener("error", closeAndSettle);
  }

  private clearSocketWatchdog(): void {
    if (this.socketWatchdog) {
      this.clearWatchdog(this.socketWatchdog);
      this.socketWatchdog = null;
    }
  }

  private scheduleReconnect(attempt: number): void {
    const baseDelay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    const delay = Math.round(baseDelay * (0.75 + this.random() * 0.5));
    this.reconnectTimer = this.scheduleTimer(() => {
      this.reconnectTimer = null;
      this.send({ attempt, type: "retry" });
    }, delay);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled connection state: ${JSON.stringify(value)}`);
}

/**
 * Keep the lossy event channel connected. Every attempt asks for a fresh
 * one-time ticket (the SDK hands the first connect after login the ticket the
 * login returned); watchdogs bound a hung ticket request or opening handshake;
 * and one settled guard coalesces the browser's usual error+close pair.
 */
export function startServerEventsConnectionLoop(
  input: ServerEventsConnectionLoopInput,
  deps: ServerEventsConnectionLoopDeps = {},
): () => void {
  const {
    clearTimer,
    clearWatchdog,
    now,
    random,
    scheduleTimer,
    scheduleWatchdog,
  } = deps;
  const loop = new ServerEventsConnectionLoop(
    input,
    (timer) => (clearTimer ? clearTimer(timer) : clearTimeout(timer)),
    (timer) => (clearWatchdog ? clearWatchdog(timer) : clearTimeout(timer)),
    () => (now ? now() : Date.now()),
    () => (random ? random() : Math.random()),
    (callback, delayMs) =>
      scheduleTimer
        ? scheduleTimer(callback, delayMs)
        : setTimeout(callback, delayMs),
    (callback, delayMs) =>
      scheduleWatchdog
        ? scheduleWatchdog(callback, delayMs)
        : setTimeout(callback, delayMs),
  );
  loop.start();
  return () => loop.stop();
}
