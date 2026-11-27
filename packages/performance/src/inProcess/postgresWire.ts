/**
 * Counts PostgreSQL protocol messages in one direction of one connection
 * without buffering their bodies. Every message after the frontend's untyped
 * startup packet is a one-byte type and a big-endian length that counts
 * itself but not the type.
 * https://www.postgresql.org/docs/current/protocol-message-formats.html
 */
export class PostgresMessageStream {
  private readonly header = new Uint8Array(5);
  private headerBytes = 0;
  private remaining = 0;
  private untyped: boolean;

  constructor(
    private readonly onMessage: (type: string) => void,
    options: { readonly startup: boolean },
  ) {
    this.untyped = options.startup;
  }

  push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.remaining > 0) {
        const skipped = Math.min(this.remaining, chunk.length - offset);
        this.remaining -= skipped;
        offset += skipped;
      } else {
        offset = this.readHeader(chunk, offset);
      }
    }
  }

  /** Copies header bytes from `offset`; returns the next unread offset. */
  private readHeader(chunk: Uint8Array, offset: number): number {
    const size = this.untyped ? 4 : 5;
    const copied = Math.min(size - this.headerBytes, chunk.length - offset);
    this.header.set(chunk.subarray(offset, offset + copied), this.headerBytes);
    this.headerBytes += copied;
    if (this.headerBytes === size) this.finishHeader();
    return offset + copied;
  }

  private finishHeader(): void {
    this.headerBytes = 0;
    const length = new DataView(this.header.buffer).getInt32(
      this.untyped ? 0 : 1,
    );
    if (length < 4) throw new Error("Malformed PostgreSQL message length.");
    this.remaining = length - 4;
    if (!this.untyped) {
      this.onMessage(String.fromCharCode(this.header[0] ?? 0));
      return;
    }
    // An eight-byte packet asks for TLS or GSS encryption, after which
    // nothing on the connection is readable here.
    if (length === 8)
      throw new Error("Encrypted PostgreSQL connections are not counted.");
    this.untyped = false;
    this.onMessage("startup");
  }
}

export interface PostgresTraffic {
  /** Connections the API opened through the proxy. */
  connections: number;
  /** Simple-protocol queries plus extended-protocol executes. */
  statements: number;
  /** ReadyForQuery messages: one per completed client-server exchange. */
  roundTrips: number;
  /** DataRow messages the server returned. */
  rows: number;
  bytesSent: number;
  bytesReturned: number;
}

export function emptyTraffic(): PostgresTraffic {
  return {
    connections: 0,
    statements: 0,
    roundTrips: 0,
    rows: 0,
    bytesSent: 0,
    bytesReturned: 0,
  };
}

export function trafficSince(
  now: PostgresTraffic,
  before: PostgresTraffic,
): PostgresTraffic {
  return {
    connections: now.connections - before.connections,
    statements: now.statements - before.statements,
    roundTrips: now.roundTrips - before.roundTrips,
    rows: now.rows - before.rows,
    bytesSent: now.bytesSent - before.bytesSent,
    bytesReturned: now.bytesReturned - before.bytesReturned,
  };
}

/** Message counters for both directions of one proxied connection. */
export function countConnection(traffic: PostgresTraffic) {
  traffic.connections++;
  const frontend = new PostgresMessageStream(
    (type) => {
      if (type === "Q" || type === "E") traffic.statements++;
    },
    { startup: true },
  );
  const backend = new PostgresMessageStream(
    (type) => {
      if (type === "Z") traffic.roundTrips++;
      else if (type === "D") traffic.rows++;
    },
    { startup: false },
  );
  return {
    sent(chunk: Uint8Array) {
      traffic.bytesSent += chunk.length;
      frontend.push(chunk);
    },
    returned(chunk: Uint8Array) {
      traffic.bytesReturned += chunk.length;
      backend.push(chunk);
    },
  };
}
