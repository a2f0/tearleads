import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

// The Workers TCP socket API, declared locally: the workspace compiles against
// Bun's globals and does not install the Workers type package.
export interface WorkersSocketOptions {
  readonly allowHalfOpen?: boolean;
  readonly secureTransport?: "off" | "on" | "starttls";
}

export interface WorkersTlsOptions {
  readonly expectedServerHostname?: string;
}

export interface WorkersSocket {
  readonly closed: Promise<void>;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
  startTls(options?: WorkersTlsOptions): WorkersSocket;
}

type WriteCallback = (error?: Error) => void;
type ConnectSocket = (
  address: string,
  options?: WorkersSocketOptions,
) => WorkersSocket;

interface PendingWrite {
  readonly callback: WriteCallback;
  readonly data: Buffer;
}

// Resolved by the runtime, not the bundler; only Workers provide it.
const cloudflareSocketsModule = "cloudflare:sockets";

async function loadCloudflareConnect(): Promise<ConnectSocket> {
  const sockets: { readonly connect: ConnectSocket } = await import(
    cloudflareSocketsModule
  );
  return sockets.connect;
}

/**
 * The Duplex-like stream pg's Connection drives on Workers, over the runtime's
 * TCP socket API. It mirrors pg's own Cloudflare adapter with one change: pg
 * sends each protocol message of a query (Parse, Bind, Describe, Execute,
 * Sync) as its own write, every write becomes its own TCP segment because the
 * socket cannot request TCP_NODELAY, and the server's delayed ACK then stalls
 * each parameterized query by about 40 ms. Gathering one tick's writes into a
 * single write removes the stall; the messages are self-delimiting, so the
 * server sees the same byte stream.
 */
export class WorkersPostgresSocket extends EventEmitter {
  writable = false;
  destroyed = false;
  private socket: WorkersSocket | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private upgrading = false;
  private upgraded = false;
  private secureDataSeen = false;
  private pending: PendingWrite[] = [];
  private flushScheduled = false;

  constructor(
    readonly ssl: boolean,
    private readonly loadConnect: () => Promise<ConnectSocket> = loadCloudflareConnect,
  ) {
    super();
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  async connect(
    port: number,
    host: string,
    connectListener?: () => void,
  ): Promise<this | undefined> {
    try {
      if (connectListener) {
        this.once("connect", connectListener);
      }
      const connect = await this.loadConnect();
      const socket = connect(
        `${host}:${port}`,
        this.ssl ? { secureTransport: "starttls" } : {},
      );
      const writer = socket.writable.getWriter();
      this.socket = socket;
      this.writer = writer;
      this.watchClose(socket);
      this.reader = socket.readable.getReader();
      // Before STARTTLS only the server's one-byte answer may be read on the
      // plain socket; the TLS reader takes over afterwards.
      void (this.ssl ? this.readOnce() : this.readAll()).catch(
        (error: unknown) => this.emit("error", error),
      );
      await writer.ready;
      this.writable = true;
      this.emit("connect");
      return this;
    } catch (error) {
      this.emit("error", error);
      return undefined;
    }
  }

  write(
    data: Uint8Array | string,
    encoding: BufferEncoding | WriteCallback = "utf8",
    callback: WriteCallback = () => {},
  ): true {
    // Node streams accept `write(data, callback)`; pg uses that form when it
    // terminates a connection, and that callback is what closes the socket.
    const resolvedEncoding: BufferEncoding =
      typeof encoding === "function" ? "utf8" : encoding;
    const resolvedCallback: WriteCallback =
      typeof encoding === "function" ? encoding : callback;
    const bytes =
      typeof data === "string"
        ? Buffer.from(data, resolvedEncoding)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
    this.pending.push({ callback: resolvedCallback, data: bytes });
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
    return true;
  }

  end(
    data: Uint8Array | string = Buffer.alloc(0),
    encoding: BufferEncoding | WriteCallback = "utf8",
    callback: WriteCallback = () => {},
  ): this {
    const resolvedCallback =
      typeof encoding === "function" ? encoding : callback;
    const resolvedEncoding = typeof encoding === "function" ? "utf8" : encoding;
    this.write(data, resolvedEncoding, (error) => {
      void this.socket?.close().catch(() => {});
      resolvedCallback(error);
    });
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this.end();
  }

  startTls(options: WorkersTlsOptions): void {
    if (this.upgraded || !this.socket) {
      this.emit("error", new Error("Cannot start TLS twice on one socket"));
      return;
    }
    this.writer?.releaseLock();
    this.reader?.releaseLock();
    this.upgrading = true;
    this.socket = this.socket.startTls(options);
    this.writer = this.socket.writable.getWriter();
    this.reader = this.socket.readable.getReader();
    this.watchClose(this.socket);
    void this.readAll().catch((error: unknown) => this.emit("error", error));
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    const payload = Buffer.concat(batch.map((entry) => entry.data));
    const settle = (error?: Error) => {
      for (const entry of batch) {
        entry.callback(error);
      }
    };
    // pg ends a socket by writing an empty buffer whose callback closes it;
    // that callback must still run after everything queued before it.
    if (payload.length === 0) {
      settle();
      return;
    }
    const writer = this.writer;
    if (!writer) {
      settle(new Error("The socket is not connected"));
      return;
    }
    writer.write(payload).then(
      () => settle(),
      (reason: unknown) => {
        // pg's write callbacks are no-ops, so a failed write must also fail
        // the stream, or the query waiting on its reply would never settle.
        const error =
          reason instanceof Error ? reason : new Error(String(reason));
        settle(error);
        this.emit("error", error);
        void this.socket?.close().catch(() => {});
      },
    );
  }

  private async readOnce(): Promise<void> {
    const reader = this.reader;
    if (!reader) {
      return;
    }
    const { value } = await reader.read();
    if (value) {
      this.emit("data", Buffer.from(value));
    }
  }

  private async readAll(): Promise<void> {
    const reader = this.reader;
    if (!reader) {
      return;
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      if (this.upgraded) {
        this.secureDataSeen = true;
      }
      this.emit("data", Buffer.from(value));
    }
  }

  private watchClose(socket: WorkersSocket): void {
    socket.closed
      .then(() => {
        if (this.upgrading) {
          this.upgrading = false;
          this.upgraded = true;
          return;
        }
        this.socket = null;
        // The runtime reports a refused certificate only by closing the
        // upgraded socket; a server that accepted the handshake always
        // answers the startup message, so a silent close means TLS failed.
        if (this.upgraded && !this.secureDataSeen) {
          this.emit(
            "error",
            new Error(
              "TLS negotiation with the database failed: the server's certificate was not accepted or the connection closed during the handshake",
            ),
          );
        }
        this.emit("close");
      })
      .catch((error: unknown) => this.emit("error", error));
  }
}

/** The `stream` factory pg's Connection accepts. */
export function createWorkersPostgresStream(config: {
  readonly ssl?: unknown;
}): WorkersPostgresSocket {
  return new WorkersPostgresSocket(Boolean(config.ssl));
}
