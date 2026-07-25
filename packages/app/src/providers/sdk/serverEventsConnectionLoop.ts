interface ServerEventsConnectionLoopInput {
  readonly onDisconnect: () => void;
  readonly onMessage: (ws: WebSocket, event: MessageEvent) => void;
  readonly onOpen: (ws: WebSocket) => void;
  readonly requestTicket: () => Promise<string | null>;
  readonly wsUrl: string;
}

type TimerHandle = number | ReturnType<typeof setTimeout>;

interface ServerEventsConnectionLoopDeps {
  readonly clearTimer?: ((timer: TimerHandle) => void) | undefined;
  readonly createSocket?: ((url: string) => WebSocket) | undefined;
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

function appendTicketToWsUrl(wsUrl: string, ticket: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

class ServerEventsConnectionLoop {
  private cancelled = false;
  private connecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: TimerHandle | null = null;
  private socketWatchdog: TimerHandle | null = null;
  private settleTicketRequest: (() => void) | null = null;
  private settleSocket: (() => void) | null = null;
  private socket: WebSocket | null = null;

  constructor(
    private readonly input: ServerEventsConnectionLoopInput,
    private readonly clearTimer: (timer: TimerHandle) => void,
    private readonly clearWatchdog: (timer: TimerHandle) => void,
    private readonly createSocket: (url: string) => WebSocket,
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
    void this.connect();
  }

  stop(): void {
    this.cancelled = true;
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearSocketWatchdog();
    this.settleTicketRequest?.();
    const socket = this.socket;
    const settle = this.settleSocket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Cleanup must still settle the logical connection.
    } finally {
      settle?.();
    }
  }

  private async connect(): Promise<void> {
    if (this.cancelled || this.connecting || this.socket) {
      return;
    }
    this.connecting = true;
    const ticket = await this.requestTicket();
    this.connecting = false;
    if (this.cancelled) {
      return;
    }
    if (ticket === null) {
      this.scheduleReconnect();
      return;
    }

    try {
      this.bindSocket(
        this.createSocket(appendTicketToWsUrl(this.input.wsUrl, ticket)),
      );
    } catch {
      this.scheduleReconnect();
    }
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
        if (this.settleTicketRequest === cancel) {
          this.settleTicketRequest = null;
        }
        resolve(ticket);
      };
      const cancel = () => finish(null);
      this.settleTicketRequest = cancel;
      watchdog = this.scheduleWatchdog(cancel, CONNECTION_WATCHDOG_MS);
      void this.input.requestTicket().then(finish, cancel);
    });
  }

  private bindSocket(ws: WebSocket): void {
    this.socket = ws;
    let openedAtMs: number | null = null;
    let settled = false;
    const disconnect = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      this.clearSocketWatchdog();
      if (this.socket === ws) {
        this.socket = null;
      }
      if (this.settleSocket === disconnect) {
        this.settleSocket = null;
      }
      if (
        openedAtMs !== null &&
        this.now() - openedAtMs >= STABLE_CONNECTION_MS
      ) {
        this.reconnectAttempt = 0;
      }
      this.input.onDisconnect();
      this.scheduleReconnect();
    };
    this.settleSocket = disconnect;
    this.socketWatchdog = this.scheduleWatchdog(() => {
      try {
        ws.close();
      } finally {
        disconnect();
      }
    }, CONNECTION_WATCHDOG_MS);

    ws.addEventListener("open", () => {
      if (!this.cancelled && this.socket === ws) {
        this.clearSocketWatchdog();
        openedAtMs = this.now();
        this.input.onOpen(ws);
      }
    });
    ws.addEventListener("message", (event) => {
      if (!this.cancelled && this.socket === ws) {
        this.input.onMessage(ws, event);
      }
    });
    ws.addEventListener("close", disconnect);
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } finally {
        disconnect();
      }
    });
  }

  private clearSocketWatchdog(): void {
    if (this.socketWatchdog) {
      this.clearWatchdog(this.socketWatchdog);
      this.socketWatchdog = null;
    }
  }

  private scheduleReconnect(): void {
    if (
      this.cancelled ||
      this.connecting ||
      this.socket ||
      this.reconnectTimer
    ) {
      return;
    }
    const baseDelay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    const delay = Math.round(baseDelay * (0.75 + this.random() * 0.5));
    this.reconnectTimer = this.scheduleTimer(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}

/**
 * Keep the lossy event channel connected. Every retry mints a fresh one-time
 * ticket; watchdogs bound a hung ticket request or opening handshake; and one
 * settled guard coalesces the browser's usual error+close pair.
 */
export function startServerEventsConnectionLoop(
  input: ServerEventsConnectionLoopInput,
  deps: ServerEventsConnectionLoopDeps = {},
): () => void {
  const {
    clearTimer,
    clearWatchdog,
    createSocket,
    now,
    random,
    scheduleTimer,
    scheduleWatchdog,
  } = deps;
  const loop = new ServerEventsConnectionLoop(
    input,
    (timer) => (clearTimer ? clearTimer(timer) : clearTimeout(timer)),
    (timer) => (clearWatchdog ? clearWatchdog(timer) : clearTimeout(timer)),
    (url) => (createSocket ? createSocket(url) : new WebSocket(url)),
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
