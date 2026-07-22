import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "../src/types";

type RequestMessage = {
  id: number;
  method: string;
  params: unknown;
};

export type MockConnectionState = {
  readonly port: MockMessagePort | null;
  readonly requests: RequestMessage[];
  closed: boolean;
  dbName: string | null;
  initializing: boolean;
};

function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "number" &&
    typeof Reflect.get(value, "method") === "string"
  );
}

export class MockMessagePort extends EventTarget {
  closed = false;
  peer: MockMessagePort | null = null;
  started = false;

  start() {
    this.started = true;
  }

  close() {
    this.closed = true;
  }

  postMessage(message: unknown) {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) {
      return;
    }

    queueMicrotask(() => {
      if (!this.closed && !peer.closed) {
        peer.dispatchEvent(new MessageEvent("message", { data: message }));
      }
    });
  }
}

export class MockMessageChannel {
  static instances: MockMessageChannel[] = [];

  readonly port1 = new MockMessagePort();
  readonly port2 = new MockMessagePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
    MockMessageChannel.instances.push(this);
  }

  static reset() {
    MockMessageChannel.instances = [];
  }
}

export class StatefulMockWorker extends EventTarget {
  static constructionCount = 0;
  static lastConstructed: StatefulMockWorker | null = null;

  readonly directConnection = this.createConnection(null);
  readonly connections: MockConnectionState[] = [this.directConnection];
  rejectTransfers = false;
  terminated = false;

  constructor(_scriptUrl: string | URL, _options?: WorkerOptions) {
    super();
    StatefulMockWorker.constructionCount += 1;
    StatefulMockWorker.lastConstructed = this;
  }

  static reset() {
    StatefulMockWorker.constructionCount = 0;
    StatefulMockWorker.lastConstructed = null;
  }

  terminate() {
    this.terminated = true;
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    if (
      typeof message === "object" &&
      message !== null &&
      Reflect.get(message, "type") === WORKER_CONNECT_PORT_MESSAGE_TYPE
    ) {
      if (this.rejectTransfers) {
        throw new Error("Failed to transfer database client port.");
      }

      const port = transfer?.[0] as unknown;
      if (!(port instanceof MockMessagePort)) {
        throw new Error("Expected a database client port.");
      }

      const connection = this.createConnection(port);
      this.connections.push(connection);
      port.start();
      port.addEventListener("message", (event) => {
        if (event instanceof MessageEvent) {
          this.handleRequest(connection, event.data);
        }
      });
      return;
    }

    this.handleRequest(this.directConnection, message);
  }

  private createConnection(port: MockMessagePort | null): MockConnectionState {
    return {
      closed: false,
      dbName: null,
      initializing: false,
      port,
      requests: [],
    };
  }

  private handleRequest(connection: MockConnectionState, value: unknown) {
    if (!isRequestMessage(value)) {
      return;
    }

    connection.requests.push(value);
    if (value.method === "init") {
      connection.initializing = true;
      if (connection.port === null) {
        return;
      }
      const params = value.params;
      const dbName =
        typeof params === "object" && params !== null
          ? Reflect.get(params, "dbName")
          : null;
      connection.dbName = typeof dbName === "string" ? dbName : null;
      connection.initializing = false;
    } else if (value.method === "close") {
      connection.closed = true;
    }

    const result =
      value.method === "ping" ? { ok: true, message: "pong" } : { ok: true };
    queueMicrotask(() => {
      const response = { id: value.id, result };
      if (connection.port) {
        connection.port.postMessage(response);
      } else {
        this.dispatchEvent(new MessageEvent("message", { data: response }));
      }
    });
  }
}
