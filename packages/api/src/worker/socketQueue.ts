import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";

/**
 * Serializes one socket's gateway events in arrival order, as Bun's handler
 * contract guarantees: open first, then each message, then close. Two bounds
 * keep a flood during a slow authorization from holding the shared hub's
 * memory: a count of pending frames and their total bytes, which also caps
 * the container ids those frames can carry before the gateway's own
 * per-declaration limits apply. Closing, which an overflow does at once,
 * discards whatever is still queued and runs the gateway's close as soon as
 * the in-flight event finishes, so a gone socket never processes further
 * declarations or keeps its timers.
 */
export interface SocketQueueHandlers {
  readonly open: () => Promise<void>;
  readonly message: (data: string) => Promise<void>;
  readonly close: () => void;
  readonly report: (error: unknown) => void;
  /** Called when a bound is exceeded; the caller closes the socket. */
  readonly overflow: (reason: string) => void;
}

export interface SocketQueueLimits {
  readonly maxQueuedMessages: number;
  readonly maxQueuedBytes: number;
}

const DEFAULT_SOCKET_QUEUE_LIMITS: SocketQueueLimits = {
  maxQueuedMessages: 32,
  maxQueuedBytes: 4 * MAX_WS_CLIENT_MESSAGE_BYTES,
};

export class SocketQueue {
  private tail: Promise<void>;
  private queuedMessages = 0;
  private queuedBytes = 0;
  private closed = false;

  constructor(
    private readonly handlers: SocketQueueHandlers,
    private readonly limits: SocketQueueLimits = DEFAULT_SOCKET_QUEUE_LIMITS,
  ) {
    this.tail = handlers.open().catch(handlers.report);
  }

  /** Queue a client frame; returns false when the socket was closed instead. */
  enqueue(data: string, byteLength: number): boolean {
    if (this.closed) {
      return false;
    }
    if (
      this.queuedMessages >= this.limits.maxQueuedMessages ||
      this.queuedBytes + byteLength > this.limits.maxQueuedBytes
    ) {
      // The socket is being closed; nothing queued behind the flood may
      // still run while the closing handshake completes.
      this.handlers.overflow("Too many pending messages");
      this.close();
      return false;
    }
    this.queuedMessages += 1;
    this.queuedBytes += byteLength;
    this.tail = this.tail
      .then(() => {
        this.queuedMessages -= 1;
        this.queuedBytes -= byteLength;
        return this.closed ? undefined : this.handlers.message(data);
      })
      .catch(this.handlers.report);
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    // Queued frames become no-ops; the gateway closes after the running one.
    this.tail = this.tail.then(() => this.handlers.close());
  }

  /** Resolves once every accepted event, including close, has run. */
  settled(): Promise<void> {
    return this.tail;
  }
}
