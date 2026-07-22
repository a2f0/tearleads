import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "../src/types";

type RequestMessage = {
  id: number;
  method: string;
  params: unknown;
};

export type MockConnectionState = {
  readonly port: MessagePort | null;
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

export class MockMessageChannel extends MessageChannel {
  static instances: MockMessageChannel[] = [];
  static closedPorts = new WeakSet<MessagePort>();
  static startedPorts = new WeakSet<MessagePort>();

  constructor() {
    super();
    for (const port of [this.port1, this.port2]) {
      const close = port.close.bind(port);
      const start = port.start.bind(port);
      port.close = () => {
        MockMessageChannel.closedPorts.add(port);
        close();
      };
      port.start = () => {
        MockMessageChannel.startedPorts.add(port);
        start();
      };
    }
    MockMessageChannel.instances.push(this);
  }

  static reset() {
    MockMessageChannel.instances = [];
    MockMessageChannel.closedPorts = new WeakSet();
    MockMessageChannel.startedPorts = new WeakSet();
  }

  static isClosed(port: MessagePort | undefined): boolean {
    return port !== undefined && MockMessageChannel.closedPorts.has(port);
  }

  static isStarted(port: MessagePort | undefined): boolean {
    return port !== undefined && MockMessageChannel.startedPorts.has(port);
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

      const port = transfer?.[0];
      if (!(port instanceof MessagePort)) {
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

  private createConnection(port: MessagePort | null): MockConnectionState {
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
