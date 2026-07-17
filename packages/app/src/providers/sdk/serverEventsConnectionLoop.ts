interface ServerEventsConnectionLoopInput {
  readonly onDisconnect: () => void;
  readonly onMessage: (ws: WebSocket, event: MessageEvent) => void;
  readonly onOpen: (ws: WebSocket) => void;
  readonly requestTicket: () => Promise<string | null>;
  readonly wsUrl: string;
}

interface ServerEventsConnectionLoopDeps {
  readonly clearTimer?:
    | ((timer: ReturnType<typeof setTimeout>) => void)
    | undefined;
  readonly createSocket?: ((url: string) => WebSocket) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => number) | undefined;
  readonly scheduleTimer?:
    | ((callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>)
    | undefined;
}

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STABLE_CONNECTION_MS = 10_000;

function appendTicketToWsUrl(wsUrl: string, ticket: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

class ServerEventsConnectionLoop {
  private cancelled = false;
  private connecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private settleSocket: (() => void) | null = null;
  private socket: WebSocket | null = null;

  constructor(
    private readonly input: ServerEventsConnectionLoopInput,
    private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void,
    private readonly createSocket: (url: string) => WebSocket,
    private readonly now: () => number,
    private readonly random: () => number,
    private readonly scheduleTimer: (
      callback: () => void,
      delayMs: number,
    ) => ReturnType<typeof setTimeout>,
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
    try {
      return await this.input.requestTicket();
    } catch {
      // A transient ticket failure uses the same bounded retry as a close.
      return null;
    }
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

    ws.addEventListener("open", () => {
      if (!this.cancelled && this.socket === ws) {
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
 * ticket; one settled guard coalesces the browser's usual error+close pair.
 */
export function startServerEventsConnectionLoop(
  input: ServerEventsConnectionLoopInput,
  deps: ServerEventsConnectionLoopDeps = {},
): () => void {
  const loop = new ServerEventsConnectionLoop(
    input,
    deps.clearTimer ?? clearTimeout,
    deps.createSocket ?? ((url) => new WebSocket(url)),
    deps.now ?? Date.now,
    deps.random ?? Math.random,
    deps.scheduleTimer ?? setTimeout,
  );
  loop.start();
  return () => loop.stop();
}
